import type amqp from "amqplib";
import { ensureCreditsReleased } from "../../services/credits.ts";
import { isPositiveInt } from "../../util/isPositiveInt.ts";

export async function consumeOrderReleased(ch: amqp.ConfirmChannel): Promise<void> {
    await ch.consume("credit.order-released", async msg => {
        if (msg === null) return;

        try {
            const payload = JSON.parse(msg.content.toString()) as {
                errandId?: unknown;
            } | null; 
            if (payload === null || !isPositiveInt(payload.errandId)) {
                throw new Error("order.released must contain valid errandId")
            }

            const { errandId } = payload;

            await ensureCreditsReleased(errandId);
            ch.ack(msg)
        } catch (error) {
            console.error("Failed to process credit.order-released event", error);
        }
    }, { noAck: false })
}