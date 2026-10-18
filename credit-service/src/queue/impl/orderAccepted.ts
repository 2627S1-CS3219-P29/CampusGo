import type amqp from "amqplib";
import { ensureCreditsAccepted } from "../../services/credits.ts";
import { isPositiveInt } from "../../util/isPositiveInt.ts";

export async function consumeOrderAccepted(ch: amqp.ConfirmChannel): Promise<void> {
    await ch.consume("credit.order-accepted", async msg => {
        if (msg === null) return;

        try {
            const payload = JSON.parse(msg.content.toString()) as {
                errandId?: unknown;
                courierId?: unknown;
            } | null; 
            if (payload === null
                || !isPositiveInt(payload.errandId)
                || !isPositiveInt(payload.courierId)
            ) {
                throw new Error("order.accepted must contain valid errandId and courierId")
            }

            const { errandId, courierId } = payload;

            await ensureCreditsAccepted(errandId, courierId);
            ch.ack(msg)
        } catch (error) {
            console.error("Failed to process order.accepted event", error);
        }
    }, { noAck: false })
}
