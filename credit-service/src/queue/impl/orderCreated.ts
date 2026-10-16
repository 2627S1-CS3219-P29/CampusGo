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
                courierId?: unknown;
                amount?: unknown
            } | null; 
            if (payload === null
                || !isPositiveInt(payload.errandId)
                || !isPositiveInt(payload.requestorId)
                || !isPositiveInt(payload.courierId)
                || !isPositiveInt(payload.amount)
            ) {
                throw new Error("order.created must contain valid errandId, requestorId, courierId and amount")
            }

            const { errandId, requestorId, courierId, amount } = payload;

            await ensureCreditsHeld(errandId, requestorId, courierId, amount);
            ch.ack(msg)
        } catch (error) {
            console.error("Failed to process credit.order-completed event", error);
        }
    }, { noAck: false })
}
