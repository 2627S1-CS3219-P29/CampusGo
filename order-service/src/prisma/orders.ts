import { param } from "@prisma/orm-postgres/relational-core/expression";
import { db } from "./db.ts";
import config from "../config.ts";

export type OrderStatus = "OPEN" | "ACCEPTED" | "COLLECTED" | "DELIVERED" | "CANCELLED" | "EXPIRED";

// the status a new order starts in. With the credit service integration this becomes PENDING,
// and the order moves to OPEN once its credits are held (or REJECTED if they cannot be)
const INITIAL_STATUS: OrderStatus = "OPEN";
export type PickupType = "SUPPLIER" | "BUILDING";

// a building pickup or dropoff: the building, then where in it
export interface BuildingSpot {
    locationId: number;
    floor: number;
    room: string | null;
}

export interface Order {
    id: string;
    idempotencyKey: string | null;
    requesterId: number;
    courierId: number | null;
    pickupType: PickupType;
    // null for a BUILDING pickup
    supplierId: number | null;
    // the building and floor; for a SUPPLIER pickup, the supplier's (floor null if it has none).
    // null only on supplier pickups made before buildings were stored
    pickupLocationId: number | null;
    pickupFloor: number | null;
    // only given for a BUILDING pickup
    pickupRoom: string | null;
    // null only on orders made before buildings were required for dropoff
    dropoffLocationId: number | null;
    dropoffFloor: number | null;
    dropoffRoom: string | null;
    // readable snapshots, e.g. "Com 2, Level 3, #01-23, outside the lift"
    pickupLocation: string;
    dropoffLocation: string;
    itemDescription: string;
    creditBounty: number;
    additionalDetails: string | null;
    status: OrderStatus;
    // ISO 8601
    expiresAt: string;
    createdAt: string;
    updatedAt: string;
}

export interface NewOrder {
    idempotencyKey: string | null;
    requesterId: number;
    // a spot in a building; for a SUPPLIER pickup, the supplier's building and floor, with no room
    pickup:
        | { type: "SUPPLIER"; supplierId: number; locationId: number; floor: number | null }
        | ({ type: "BUILDING" } & BuildingSpot);
    dropoff: BuildingSpot;
    pickupLocation: string;
    dropoffLocation: string;
    itemDescription: string;
    creditBounty: number;
    additionalDetails: string | null;
    expiresAt: Date;
}

type OrderRow = Omit<Order, "status" | "pickupType"> & { status: string; pickupType: string };

// postgres text "2026-10-11 17:24:26.326292+00" -> ISO 8601
const toIso = (ts: string) => new Date(ts.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00")).toISOString();

const toOrder = (row: OrderRow): Order => ({
    ...row,
    status: <OrderStatus>row.status,
    pickupType: <PickupType>row.pickupType,
    expiresAt: toIso(row.expiresAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
});

export type OrderScope = "open" | "requested" | "delivering" | "all";

export interface OrderFilter {
    scope: OrderScope;
    // the signed-in user, for the "open", "requested" and "delivering" scopes
    userId: number;
    // only these statuses; all when left out
    statuses?: OrderStatus[];
    page: number;
    pageSize: number;
}

export interface OrderPage {
    data: Order[];
    total: number;
}

export const findOrderById = async (id: string): Promise<Order | null> => {
    const row = await db.orm.public.Order.where({ id }).first();
    return row ? toOrder(row) : null;
};

export const findOrderByIdempotencyKey = async (idempotencyKey: string): Promise<Order | null> => {
    const row = await db.orm.public.Order.where({ idempotencyKey }).first();
    return row ? toOrder(row) : null;
};

export const createOrder = async (order: NewOrder): Promise<Order> => {
    const { pickup, dropoff, ...rest } = order;
    const building = pickup.type === "BUILDING" ? pickup : null;
    const row = await db.orm.public.Order.create({
        ...rest,
        id: crypto.randomUUID(),
        status: INITIAL_STATUS,
        expiresAt: order.expiresAt.toISOString(),
        pickupType: pickup.type,
        supplierId: pickup.type === "SUPPLIER" ? pickup.supplierId : null,
        pickupLocationId: pickup.locationId,
        pickupFloor: pickup.floor,
        pickupRoom: building?.room ?? null,
        dropoffLocationId: dropoff.locationId,
        dropoffFloor: dropoff.floor,
        dropoffRoom: dropoff.room,
    });
    return toOrder(row);
};

const text = (v: string) => param(v, { codecId: "pg/text@1" });
const textArray = (v: string[] | null) => param(v, { codecId: "pg/text-array@1" });
const int = (v: number | null) => param(v, { codecId: "pg/int4@1" });
const bool = (v: boolean) => param(v, { codecId: "pg/bool@1" });

const rowSpec = {
    id: "pg/text@1",
    idempotencyKey: { codecId: "pg/text@1", nullable: true },
    requesterId: "pg/int4@1",
    courierId: { codecId: "pg/int4@1", nullable: true },
    pickupType: "pg/text@1",
    supplierId: { codecId: "pg/int4@1", nullable: true },
    pickupLocationId: { codecId: "pg/int4@1", nullable: true },
    pickupFloor: { codecId: "pg/int4@1", nullable: true },
    pickupRoom: { codecId: "pg/text@1", nullable: true },
    dropoffLocationId: { codecId: "pg/int4@1", nullable: true },
    dropoffFloor: { codecId: "pg/int4@1", nullable: true },
    dropoffRoom: { codecId: "pg/text@1", nullable: true },
    pickupLocation: "pg/text@1",
    dropoffLocation: "pg/text@1",
    itemDescription: "pg/text@1",
    creditBounty: "pg/int4@1",
    additionalDetails: { codecId: "pg/text@1", nullable: true },
    status: "pg/text@1",
    expiresAt: "pg/timestamptz-string@1",
    createdAt: "pg/timestamptz-string@1",
    updatedAt: "pg/timestamptz-string@1",
} as const;

// every column in rowSpec, for raw SELECT and RETURNING
const orderColumns = () => db.raw.sql`
    id, "idempotencyKey", "requesterId", "courierId", "pickupType", "supplierId",
    "pickupLocationId", "pickupFloor", "pickupRoom",
    "dropoffLocationId", "dropoffFloor", "dropoffRoom",
    "pickupLocation", "dropoffLocation", "itemDescription", "creditBounty",
    "additionalDetails", status, "expiresAt", "createdAt", "updatedAt"`.returns("pg/text@1");

export interface Transition {
    // the status the order must still be in for the change to happen
    from: OrderStatus;
    to: OrderStatus;
    // set the courier, e.g. when accepting
    courierId?: number;
    // only change it before this time: "deadline" is expiresAt, "grace" is expiresAt plus the
    // grace period a collected order gets; left out, there is no time limit
    before?: "deadline" | "grace";
}

// SQL for "expiresAt plus the grace period"
const graceEnd = () => db.raw.sql`
    "expiresAt" + make_interval(mins => ${int(config.order.expiry.collectedGraceMinutes)})`.returns("pg/timestamptz-string@1");

/**
 * Changes an order's status in one UPDATE statement, so it is atomic: the
 * status (and expiry) are checked and changed together. If another request
 * changed the order first (e.g. a second courier accepting), nothing matches
 * and null is returned.
 *
 * Not done with the ORM's where().update(), which checks with a SELECT and then
 * writes with a separate UPDATE, so two requests could both pass the check.
 */
export const transitionOrder = async (id: string, t: Transition): Promise<Order | null> => {
    const plan = db.raw.sql`
        UPDATE orders
        SET status = ${text(t.to)},
            "courierId" = COALESCE(${int(t.courierId ?? null)}, "courierId"),
            "updatedAt" = now()
        WHERE id = ${text(id)}
            AND status = ${text(t.from)}
            AND (NOT ${bool(t.before === "deadline")} OR "expiresAt" > now())
            AND (NOT ${bool(t.before === "grace")} OR ${graceEnd()} > now())
        RETURNING ${orderColumns()}
    `.returnsRow(rowSpec).build();

    const [row] = await db.runtime().query(plan);
    return row ? toOrder(<OrderRow>row) : null;
};

/**
 * Marks every order that is due as EXPIRED in one statement:
 *   OPEN or ACCEPTED past its deadline (nobody accepted it, or the courier did not collect it)
 *   COLLECTED past its deadline plus the grace period (the courier did not deliver it)
 * Returns the orders that expired, whose requesters get their credits back.
 */
export const expireDueOrders = async (): Promise<Order[]> => {
    const plan = db.raw.sql`
        UPDATE orders SET status = 'EXPIRED', "updatedAt" = now()
        WHERE (status IN ('OPEN', 'ACCEPTED') AND "expiresAt" <= now())
            OR (status = 'COLLECTED' AND ${graceEnd()} <= now())
        RETURNING ${orderColumns()}
    `.returnsRow(rowSpec).build();
    const rows = await db.runtime().query(plan);
    return rows.map(r => toOrder(<OrderRow>r));
};

/**
 * One page of orders for a scope, newest first, with the total for pagination.
 * Every condition is a parameter; a scope's condition only applies when that scope is selected,
 * and a null status list disables the status filter.
 */
export const listOrders = async (filter: OrderFilter): Promise<OrderPage> => {
    const statuses = filter.statuses?.length ? filter.statuses : null;
    const where = db.raw.sql`
        CASE ${text(filter.scope)}
            WHEN 'open' THEN status = 'OPEN' AND "expiresAt" > now() AND "requesterId" <> ${int(filter.userId)}
            WHEN 'requested' THEN "requesterId" = ${int(filter.userId)}
            WHEN 'delivering' THEN "courierId" = ${int(filter.userId)}
            ELSE true
        END
        AND (${textArray(statuses)}::text[] IS NULL OR status = ANY(${textArray(statuses)}::text[]))`.returns("pg/bool@1");

    const countPlan = db.raw.sql`
        SELECT count(*)::int AS total FROM orders WHERE ${where}
    `.returnsRow({ total: "pg/int4@1" }).build();

    // id breaks ties so pages stay stable
    const listPlan = db.raw.sql`
        SELECT ${orderColumns()} FROM orders
        WHERE ${where}
        ORDER BY "createdAt" DESC, id ASC
        LIMIT ${int(filter.pageSize)} OFFSET ${int((filter.page - 1) * filter.pageSize)}
    `.returnsRow(rowSpec).build();

    const runtime = db.runtime();
    const [[{ total }], rows] = await Promise.all([runtime.query(countPlan), runtime.query(listPlan)]);
    return { data: rows.map(r => toOrder(<OrderRow>r)), total };
};
