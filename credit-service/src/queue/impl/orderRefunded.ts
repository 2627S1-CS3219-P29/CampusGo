import type amqp from "amqplib";
import { ensureCreditsRefunded } from "../../services/credits.ts";
import { isPositiveInt } from "../../util/isPositiveInt.ts";

export async function consumeOrderRefunded(ch: amqp.ConfirmChannel): Promise<void> {
    await ch.consume("credit.order-refunded", async msg => {
        if (msg === null) return;

        try {
            const payload = JSON.parse(msg.content.toString()) as {
                errandId?: unknown;
            } | null; 
            if (payload === null || !isPositiveInt(payload.errandId)) {
                throw new Error("order.refunded must contain valid errandId")
            }

            const { errandId } = payload;

            await ensureCreditsRefunded(errandId);
            ch.ack(msg)
        } catch (error) {
            console.error("Failed to process credit.order-refunded event", error);
        }
    }, { noAck: false })
}