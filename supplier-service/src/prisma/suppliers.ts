import { param } from "@prisma/orm-postgres/relational-core/expression";
import { db } from "./db.ts";
import config from "../config.ts";
import type { SupplierType } from "../common.ts";

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

export interface ISupplierRepository {
    listSuppliers(filter: SupplierFilter): Promise<SupplierPage>;
    findSupplierById(id: number, includeDeleted?: boolean): Promise<Supplier | null>;
}

const text = (v: string | null) => param(v, { codecId: "pg/text@1" });
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

const SupplierRepo: ISupplierRepository = {
    listSuppliers,
    findSupplierById,
};
export default SupplierRepo;
