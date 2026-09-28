import { param } from "@prisma/orm-postgres/relational-core/expression";
import { db } from "./db.ts";
import config from "../config.ts";
import { SupplierType } from "../common.ts";
import { checkCrossFieldRules, hasErrors, type SupplierFields } from "../util/supplierRules.ts";
import { ErrorType, PgErrorCode, SupplierError } from "./common.ts";

export interface SupplierFilter {
    // case-insensitive substring match on name
    search?: string;
    types?: SupplierType[];
    openNow?: boolean;
    locationId?: number;
    sortDescending: boolean;
    page: number;
    pageSize: number;
    // the private (service-to-service) lookup may need suppliers that were since deleted
    includeDeleted?: boolean;
}

export interface Supplier {
    id: number;
    name: string;
    type: SupplierType;
    description: string | null;
    location: { id: number; name: string } | null;
    openingHours: { opensAt: string; closesAt: string } | null;
    // null when the supplier has no opening hours listed
    isOpenNow: boolean | null;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}

export interface SupplierPage {
    items: Supplier[];
    page: number;
    pageSize: number;
    total: number;
}

// asked before deleting, with every supplier the delete would remove
export type DeleteGuard = (supplierIds: number[]) => Promise<string | null>;

export interface ISupplierRepository {
    listSuppliers(filter: SupplierFilter): Promise<SupplierPage>;
    findSupplierById(id: number, includeDeleted?: boolean): Promise<Supplier | null>;
    createSupplier(fields: SupplierFields, actorUserId: number): Promise<number>;
    updateSupplier(id: number, patch: Partial<SupplierFields>, actorUserId: number): Promise<void>;
    deleteSupplier(id: number, actorUserId: number, guard: DeleteGuard): Promise<number[]>;
}

const text = (v: string | null) => param(v, { codecId: "pg/text@1" });
const time = (v: string | null) => param(v, { codecId: "pg/time-string@1" });
const textArray = (v: string[] | null) => param(v, { codecId: "pg/text-array@1" });
const int = (v: number | null) => param(v, { codecId: "pg/int4@1" });
const bool = (v: boolean) => param(v, { codecId: "pg/bool@1" });

const escapeLike = (s: string) => s.replace(/[\\%_]/g, c => `\\${c}`);

// campus-local wall clock, compared against opensAt/closesAt; a window with
// closesAt < opensAt wraps past midnight
const nowLocal = () => db.raw.sql`(now() AT TIME ZONE ${text(config.supplier.timezone)})::time`.returns("pg/time-string@1");
const isOpenAt = (clock: ReturnType<typeof nowLocal>) => db.raw.sql`
    CASE
        WHEN s."opensAt" IS NULL THEN NULL
        WHEN s."opensAt" <= s."closesAt" THEN ${clock} >= s."opensAt" AND ${clock} < s."closesAt"
        ELSE ${clock} >= s."opensAt" OR ${clock} < s."closesAt"
    END`.returns({ codecId: "pg/bool@1", nullable: true });

const rowSpec = {
    id: "pg/int4@1",
    name: "pg/text@1",
    type: "pg/text@1",
    description: { codecId: "pg/text@1", nullable: true },
    locationId: { codecId: "pg/int4@1", nullable: true },
    locationName: { codecId: "pg/text@1", nullable: true },
    opensAt: { codecId: "pg/time-string@1", nullable: true },
    closesAt: { codecId: "pg/time-string@1", nullable: true },
    isOpenNow: { codecId: "pg/bool@1", nullable: true },
    createdAt: "pg/timestamptz-string@1",
    updatedAt: "pg/timestamptz-string@1",
    deletedAt: { codecId: "pg/timestamptz-string@1", nullable: true },
} as const;

const selectColumns = () => db.raw.sql`
    s.id, s.name, s.type, s.description,
    s."locationId", l.name AS "locationName",
    s."opensAt", s."closesAt", ${isOpenAt(nowLocal())} AS "isOpenNow",
    s."createdAt", s."updatedAt", s."deletedAt"`.returns("pg/text@1");

type SupplierRow = {
    id: number; name: string; type: string; description: string | null;
    locationId: number | null; locationName: string | null;
    opensAt: string | null; closesAt: string | null; isOpenNow: boolean | null;
    createdAt: string; updatedAt: string; deletedAt: string | null;
};

// "09:00:00" -> "09:00"
const toHourMinute = (t: string) => t.slice(0, 5);

// postgres text "2026-09-28 16:25:28.605214+00" -> ISO 8601
const toIso = (ts: string) => new Date(ts.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00")).toISOString();

const toSupplier = (row: SupplierRow): Supplier => ({
    id: row.id,
    name: row.name,
    type: <SupplierType>row.type,
    description: row.description,
    location: row.locationId !== null ? { id: row.locationId, name: row.locationName! } : null,
    openingHours: row.opensAt !== null && row.closesAt !== null
        ? { opensAt: toHourMinute(row.opensAt), closesAt: toHourMinute(row.closesAt) }
        : null,
    isOpenNow: row.isOpenNow,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    deletedAt: row.deletedAt !== null ? toIso(row.deletedAt) : null,
});

/**
 * Search, filter, sort and paginate in a single query (FR 6.2 - 6.7).
 * Every filter is optional: a null parameter disables its condition.
 */
export const listSuppliers = async (filter: SupplierFilter): Promise<SupplierPage> => {
    const search = filter.search ? `%${escapeLike(filter.search.toLowerCase())}%` : null;
    const types = filter.types?.length ? filter.types : null;
    const where = db.raw.sql`
        (${bool(filter.includeDeleted ?? false)} OR s."deletedAt" IS NULL)
        AND (${text(search)}::text IS NULL OR lower(s.name) LIKE ${text(search)})
        AND (${textArray(types)}::text[] IS NULL OR s.type = ANY(${textArray(types)}::text[]))
        AND (${int(filter.locationId ?? null)}::int IS NULL OR s."locationId" = ${int(filter.locationId ?? null)})
        AND (NOT ${bool(filter.openNow ?? false)} OR ${isOpenAt(nowLocal())} IS TRUE)`.returns("pg/bool@1");

    const countPlan = db.raw.sql`
        SELECT count(*)::int AS total FROM supplier s WHERE ${where}
    `.returnsRow({ total: "pg/int4@1" }).build();

    // ORDER BY direction cannot be a parameter, so the descending key is only
    // non-null when sorting Z-A; id breaks ties so pages stay stable
    const listPlan = db.raw.sql`
        SELECT ${selectColumns()}
        FROM supplier s
        LEFT JOIN supplier l ON l.id = s."locationId"
        WHERE ${where}
        ORDER BY
            CASE WHEN ${bool(filter.sortDescending)} THEN lower(s.name) END DESC,
            lower(s.name) ASC,
            s.id ASC
        LIMIT ${int(filter.pageSize)} OFFSET ${int((filter.page - 1) * filter.pageSize)}
    `.returnsRow(rowSpec).build();

    const runtime = db.runtime();
    const [[{ total }], rows] = await Promise.all([
        runtime.query(countPlan),
        runtime.query(listPlan),
    ]);

    return {
        items: rows.map(r => toSupplier(<SupplierRow>r)),
        page: filter.page,
        pageSize: filter.pageSize,
        total,
    };
};

export const findSupplierById = async (id: number, includeDeleted = false): Promise<Supplier | null> => {
    const plan = db.raw.sql`
        SELECT ${selectColumns()}
        FROM supplier s
        LEFT JOIN supplier l ON l.id = s."locationId"
        WHERE s.id = ${int(id)} AND (${bool(includeDeleted)} OR s."deletedAt" IS NULL)
    `.returnsRow(rowSpec).build();

    const [row] = await db.runtime().query(plan);
    return row ? toSupplier(<SupplierRow>row) : null;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const lockedRowSpec = {
    id: "pg/int4@1",
    name: "pg/text@1",
    type: "pg/text@1",
    description: { codecId: "pg/text@1", nullable: true },
    locationId: { codecId: "pg/int4@1", nullable: true },
    opensAt: { codecId: "pg/time-string@1", nullable: true },
    closesAt: { codecId: "pg/time-string@1", nullable: true },
} as const;

/**
 * Locks a live supplier for the rest of the transaction. FOR UPDATE when we are
 * about to change it, FOR SHARE when we only need it to stay as it is (e.g. the
 * landmark a new store points at, so a concurrent delete waits for us)
 */
const lockLiveSupplier = async (tx: Tx, id: number, mode: "update" | "share"): Promise<SupplierFields & { id: number } | null> => {
    const plan = mode === "update"
        ? db.raw.sql`SELECT id, name, type, description, "locationId", "opensAt", "closesAt"
            FROM supplier WHERE id = ${int(id)} AND "deletedAt" IS NULL FOR UPDATE`.returnsRow(lockedRowSpec).build()
        : db.raw.sql`SELECT id, name, type, description, "locationId", "opensAt", "closesAt"
            FROM supplier WHERE id = ${int(id)} AND "deletedAt" IS NULL FOR SHARE`.returnsRow(lockedRowSpec).build();
    const [row] = await tx.query(plan);
    if (!row)
        return null;
    return {
        id: row.id,
        name: row.name,
        type: <SupplierType>row.type,
        description: row.description,
        locationId: row.locationId,
        openingHours: row.opensAt !== null && row.closesAt !== null
            ? { opensAt: toHourMinute(row.opensAt), closesAt: toHourMinute(row.closesAt) }
            : null,
    };
};

const assertValidLandmark = async (tx: Tx, locationId: number, selfId?: number) => {
    const invalid = (msg: string) => new SupplierError(ErrorType.Invalid, "invalid supplier", { locationId: [msg] });
    if (locationId === selfId)
        throw invalid("A supplier cannot be located at itself");
    const landmark = await lockLiveSupplier(tx, locationId, "share");
    if (!landmark)
        throw invalid(`No supplier with id ${locationId}`);
    if (landmark.type !== SupplierType.Landmark)
        throw invalid(`"${landmark.name}" is a ${landmark.type}, not a landmark`);
};

// gives a clearer message than the unique constraint would; the constraint still guards races
const assertNameAvailable = async (tx: Tx, name: string, selfId?: number) => {
    const plan = db.raw.sql`
        SELECT name, "deletedAt" IS NOT NULL AS deleted FROM supplier
        WHERE (name = ${text(name)} OR (lower(name) = lower(${text(name)}) AND "deletedAt" IS NULL))
            AND id <> ${int(selfId ?? 0)}
        LIMIT 1`.returnsRow({ name: "pg/text@1", deleted: "pg/bool@1" }).build();
    const [clash] = await tx.query(plan);
    if (clash) {
        const msg = clash.deleted
            ? `"${clash.name}" belongs to a deleted supplier, choose another name`
            : `A supplier named "${clash.name}" already exists`;
        throw new SupplierError(ErrorType.Conflict, "supplier name already in use", { name: [msg] });
    }
};

const liveSuppliersAt = async (tx: Tx, landmarkId: number): Promise<number[]> => {
    const plan = db.raw.sql`
        SELECT id FROM supplier WHERE "locationId" = ${int(landmarkId)} AND "deletedAt" IS NULL
        ORDER BY id FOR UPDATE`.returnsRow({ id: "pg/int4@1" }).build();
    return (await tx.query(plan)).map(r => r.id);
};

// FR 5.12: written in the same transaction as the change it records
const writeAudit = async (tx: Tx, supplierId: number, action: "create" | "update" | "delete", actorUserId: number) => {
    await tx.execute(db.raw.sql`
        INSERT INTO "supplierAuditLog" ("supplierId", action, "actorUserId", snapshot)
        SELECT s.id, ${text(action)}, ${int(actorUserId)}, row_to_json(s)
        FROM supplier s WHERE s.id = ${int(supplierId)}`.affectedCount().build());
};

// the checks above make these unreachable in practice, but map them in case of a race
const mapConstraintError = (e: unknown): unknown => {
    const code = (<{ sqlState?: string }>e)?.sqlState;
    if (code === PgErrorCode.uniqueViolation)
        return new SupplierError(ErrorType.Conflict, "supplier name already in use", { name: ["A supplier with this name already exists"] });
    if (code === PgErrorCode.checkViolation)
        return new SupplierError(ErrorType.Invalid, "invalid supplier");
    return e;
};

const inTransaction = async <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
    try {
        return await db.transaction(fn);
    } catch (e) {
        throw mapConstraintError(e);
    }
};

export const createSupplier = (fields: SupplierFields, actorUserId: number): Promise<number> =>
    inTransaction(async tx => {
        await assertNameAvailable(tx, fields.name);
        if (fields.locationId !== null)
            await assertValidLandmark(tx, fields.locationId);

        const [{ id }] = await tx.query(db.raw.sql`
            INSERT INTO supplier (name, type, description, "locationId", "opensAt", "closesAt", "createdBy", "updatedBy")
            VALUES (
                ${text(fields.name)}, ${text(fields.type)}, ${text(fields.description)}, ${int(fields.locationId)},
                ${time(fields.openingHours?.opensAt ?? null)}::time, ${time(fields.openingHours?.closesAt ?? null)}::time,
                ${int(actorUserId)}, ${int(actorUserId)}
            )
            RETURNING id`.returnsRow({ id: "pg/int4@1" }).build());

        await writeAudit(tx, id, "create", actorUserId);
        return id;
    });

/**
 * Applies `patch` over the stored supplier and re-checks the rules on the result,
 * so e.g. turning a store into a landmark must also clear its location
 */
export const updateSupplier = (id: number, patch: Partial<SupplierFields>, actorUserId: number): Promise<void> =>
    inTransaction(async tx => {
        const current = await lockLiveSupplier(tx, id, "update");
        if (!current)
            throw new SupplierError(ErrorType.NotFound, "supplier not found");

        const merged: SupplierFields = {
            name: patch.name ?? current.name,
            type: patch.type ?? current.type,
            description: patch.description !== undefined ? patch.description : current.description,
            locationId: patch.locationId !== undefined ? patch.locationId : current.locationId,
            openingHours: patch.openingHours !== undefined ? patch.openingHours : current.openingHours,
        };

        const errors = checkCrossFieldRules(merged);
        if (hasErrors(errors))
            throw new SupplierError(ErrorType.Invalid, "invalid supplier", errors);

        // FR 5.10: a landmark that others are located at must stay a landmark
        if (current.type === SupplierType.Landmark && merged.type !== SupplierType.Landmark) {
            const dependants = await liveSuppliersAt(tx, id);
            if (dependants.length > 0) {
                throw new SupplierError(ErrorType.Conflict, "landmark is in use", {
                    type: [`${dependants.length} supplier(s) are located at this landmark, move or delete them first`],
                });
            }
        }
        if (merged.name !== current.name)
            await assertNameAvailable(tx, merged.name, id);
        if (merged.locationId !== null && merged.locationId !== current.locationId)
            await assertValidLandmark(tx, merged.locationId, id);

        await tx.execute(db.raw.sql`
            UPDATE supplier SET
                name = ${text(merged.name)},
                type = ${text(merged.type)},
                description = ${text(merged.description)},
                "locationId" = ${int(merged.locationId)},
                "opensAt" = ${time(merged.openingHours?.opensAt ?? null)}::time,
                "closesAt" = ${time(merged.openingHours?.closesAt ?? null)}::time,
                "updatedBy" = ${int(actorUserId)},
                "updatedAt" = now()
            WHERE id = ${int(id)}`.affectedCount().build());

        await writeAudit(tx, id, "update", actorUserId);
    });

/**
 * Soft delete. Deleting a landmark also deletes the suppliers located at it (FR 5.11).
 * `guard` may veto the delete, e.g. when an errand is still ongoing (FR 5.8)
 *
 * @returns ids of every supplier deleted, the requested one first
 */
export const deleteSupplier = (id: number, actorUserId: number, guard: DeleteGuard): Promise<number[]> =>
    inTransaction(async tx => {
        const target = await lockLiveSupplier(tx, id, "update");
        if (!target)
            throw new SupplierError(ErrorType.NotFound, "supplier not found");

        const dependants = target.type === SupplierType.Landmark ? await liveSuppliersAt(tx, id) : [];
        const ids = [id, ...dependants];

        const veto = await guard(ids);
        if (veto)
            throw new SupplierError(ErrorType.Conflict, veto);

        for (const supplierId of ids) {
            await tx.execute(db.raw.sql`
                UPDATE supplier SET "deletedAt" = now(), "updatedBy" = ${int(actorUserId)}, "updatedAt" = now()
                WHERE id = ${int(supplierId)}`.affectedCount().build());
            await writeAudit(tx, supplierId, "delete", actorUserId);
        }
        return ids;
    });

const SupplierRepo: ISupplierRepository = {
    listSuppliers,
    findSupplierById,
    createSupplier,
    updateSupplier,
    deleteSupplier,
};
export default SupplierRepo;
