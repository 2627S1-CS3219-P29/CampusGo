import { param } from "@prisma/orm-postgres/relational-core/expression";
import { db, type Db, type Tx } from "./db.ts";
import type { OutboxEvent } from "../rabbitmq/events.ts";

/** Adds events to the outbox. Pass the transaction that changes the order so both commit together. */
export const enqueueEvents = async (conn: Db | Tx, events: OutboxEvent[]): Promise<void> => {
    for (const e of events) {
        await conn.orm.public.Outbox.create({ topic: e.topic, type: e.type, payload: e.payload });
    }
};

/** For events that are not tied to another change (e.g. refunding a late hold). */
export const enqueueEventsAlone = (events: OutboxEvent[]) =>
    db.transaction(tx => enqueueEvents(tx, events));

export interface PendingEvent {
    id: number;
    topic: string;
    type: string;
    payload: unknown;
    retryCount: number;
}

const rowSpec = {
    id: "pg/int4@1",
    topic: "pg/text@1",
    type: "pg/text@1",
    payload: "pg/json@1",
    retryCount: "pg/int4@1",
} as const;

/**
 * Oldest unsent events. FOR UPDATE SKIP LOCKED means two order-service instances never pick up
 * the same row, so scaling to more than one instance does not double-publish.
 */
export const fetchPendingEvents = async (tx: Tx, limit: number): Promise<PendingEvent[]> => {
    const plan = db.raw.sql`
        SELECT id, topic, type, payload, "retryCount"
        FROM outbox
        WHERE status = 'PENDING' AND ("nextRetryAt" IS NULL OR "nextRetryAt" <= now())
        ORDER BY "createdAt" ASC, id ASC
        LIMIT ${param(limit, { codecId: "pg/int4@1" })}
        FOR UPDATE SKIP LOCKED
    `.returnsRow(rowSpec).build();
    return await tx.query(plan) as PendingEvent[];
};

export const markEventSent = async (tx: Tx, id: number): Promise<void> => {
    await tx.orm.public.Outbox.where({ id }).update({ status: "COMPLETED", nextRetryAt: null, errorMessage: null });
};

/** Keeps the row PENDING and schedules another attempt; money events are never given up on. */
export const markEventFailed = async (
    tx: Tx, id: number, errorMessage: string, retryCount: number, nextRetryAt: string,
): Promise<void> => {
    await tx.orm.public.Outbox.where({ id }).update({ retryCount, errorMessage, nextRetryAt });
};
