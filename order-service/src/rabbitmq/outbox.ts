// src/rabbitmq/outbox.ts
// Relays outbox rows (written in the same transaction as the order change they describe) to
// RabbitMQ. If RabbitMQ is down the rows simply wait; nothing is lost and nothing is given up on.
import log from "../log.ts";
import { db } from "../prisma/db.ts";
import { fetchPendingEvents, markEventFailed, markEventSent } from "../prisma/outbox.ts";
import { isConnected, publishEvent } from "./client.ts";

const BATCH_SIZE = 50;
const POLL_INTERVAL_MS = 500;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sends one batch, returns how many rows were looked at. */
export const relayOnce = async (): Promise<number> => {
    return await db.transaction(async tx => {
        const rows = await fetchPendingEvents(tx, BATCH_SIZE);
        for (const row of rows) {
            try {
                // messageId is stable per row, so a re-publish after a crash carries the same id
                await publishEvent(row.topic, row.type, row.payload, `order-outbox-${row.id}`);
                await markEventSent(tx, row.id);
                log.info(`Published ${row.topic} (outbox #${row.id})`);
            } catch (e) {
                const retryCount = row.retryCount + 1;
                const delay = Math.min(BASE_RETRY_DELAY_MS * 2 ** (retryCount - 1), MAX_RETRY_DELAY_MS);
                log.warn(`Publish of outbox #${row.id} (${row.topic}) failed, attempt ${retryCount}: ${e}`);
                await markEventFailed(tx, row.id, String(e), retryCount, new Date(Date.now() + delay).toISOString());
            }
        }
        return rows.length;
    });
};

let running = false;

export const startOutboxWorker = (): void => {
    if (running) return;
    running = true;
    void (async () => {
        while (running) {
            try {
                // while the broker is down, leave rows alone instead of burning their retries
                const handled = isConnected() ? await relayOnce() : 0;
                if (handled === 0) await sleep(POLL_INTERVAL_MS);
            } catch (e) {
                log.error(`Outbox worker batch failed: ${e}`);
                await sleep(2000);
            }
        }
    })();
    log.info("Outbox worker started");
};

export const stopOutboxWorker = (): void => {
    running = false;
};
