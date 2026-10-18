import type amqp from "amqplib";
import { ensureCreditsHeld } from "../../services/credits.ts";
import { isPositiveInt } from "../../util/isPositiveInt.ts";

export async function consumeOrderCreated(ch: amqp.ConfirmChannel): Promise<void> {
    await ch.consume("credit.order-created", async msg => {
        if (msg === null) return;

        try {
            const payload = JSON.parse(msg.content.toString()) as {
                errandId?: unknown;
                requestorId?: unknown;
                amount?: unknown
            } | null; 
            if (payload === null
                || !isPositiveInt(payload.errandId)
                || !isPositiveInt(payload.requestorId)
                || !isPositiveInt(payload.amount)
            ) {
                throw new Error("order.created must contain valid errandId, requestorId and amount")
            }

            const { errandId, requestorId, amount } = payload;

            await ensureCreditsHeld(errandId, requestorId, amount);
            ch.ack(msg)
        } catch (error) {
            console.error("Failed to process order.created event", error);
        }
    }, { noAck: false })
}
