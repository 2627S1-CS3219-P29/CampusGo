import type amqp from "amqplib";
import { ensureCreditsHeld } from "../../services/credits.ts";
import { isNonEmptyString } from "../../util/isNonEmptyString.ts";
import { isPositiveInt } from "../../util/isPositiveInt.ts";

export async function consumeOrderCreated(ch: amqp.ConfirmChannel): Promise<void> {
    await ch.consume("credit.order-created", async msg => {
        if (msg === null) return;

        try {
            const payload = JSON.parse(msg.content.toString()) as {
                errandId?: unknown;
                requestorId?: unknown;
                courierId?: unknown;
                amount?: unknown
            } | null;
            if (payload === null
                || !isNonEmptyString(payload.errandId)
                || !isPositiveInt(payload.requestorId)
                || !isPositiveInt(payload.amount)
            ) {
                throw new Error("order.created must contain valid errandId, requestorId and amount")
            }

            const { errandId, requestorId, amount } = payload;
            // No courier exists yet when an errand is posted; Order sends null.
            const courierId = isPositiveInt(payload.courierId) ? payload.courierId : null;

            await ensureCreditsHeld(errandId, requestorId, courierId, amount);
            ch.ack(msg)
        } catch (error) {
            console.error("Failed to process credit.order-created event", error);
            // Retry once, then give up so the queue doesn't stall.
            ch.nack(msg, false, !msg.fields.redelivered);
        }
    }, { noAck: false })
}