import log from "../log.ts";
import type { Db } from "../prisma/db.ts";
import type { IRepoFactory } from "../prisma/factory.ts";
import type { RabbitMqProvider } from "./provider.ts";

const BATCH_SIZE = 50;
const MAX_RETRIES = 5;
const BASE_RETRY_DELAY_MS = 1000;

/// exponential backoff with jitter
const calcExpBackoff = (newRetryCount: number) =>
    BASE_RETRY_DELAY_MS * 2 ** (newRetryCount - 1) * (0.5 + Math.random());

export async function relayOnce(db: Db, repoFactory: IRepoFactory, msgQueue: RabbitMqProvider) {
    await db.transaction(async tx => {
        const { outbox } = repoFactory.buildRepos(tx);
        const rows = await outbox.getPendingEvents(BATCH_SIZE);
        if (rows.length === 0) 
            return;
        
        for (const row of rows) {
            try {
                msgQueue.publishEvent(row.topic, {
                    type: row.type,
                    ...row.payload
                });
    
                await outbox.updateCompletedEvent(row.id);
            } catch (e) {
                const errMsg = e instanceof Error ? e.message : JSON.stringify(e);
                log.warn(`worker failed to relay outbox message: ${errMsg}`);
                const newRetryCount = row.retryCount + 1;
                const shouldFail = newRetryCount >= MAX_RETRIES;
                const nextRetryAt = shouldFail ?
                    null :
                    Temporal.Now.instant().add({
                        milliseconds: calcExpBackoff(newRetryCount),
                    });
                await outbox.updateFailedEvent(row.id, errMsg, newRetryCount, nextRetryAt);
            }
            
        }
    });

}

