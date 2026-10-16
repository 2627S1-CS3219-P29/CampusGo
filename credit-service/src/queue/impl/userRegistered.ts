import type amqp from "amqplib";
import { ensureCreditAccount } from "../../services/credits.ts";

// Call after declaring and binding the queue, on each new channel.
export async function consumeUserRegistered(ch: amqp.ConfirmChannel): Promise<void> {
    await ch.consume("credit.user-registered", async msg => {
        if (msg === null) return; // RabbitMQ cancelled the consumer.

        try {
            const payload = JSON.parse(msg.content.toString()) as { userId?: unknown } | null;
            if (typeof payload?.userId !== "number") {
                throw new Error("user.registered event must contain a numeric userId");
            }

            await ensureCreditAccount(payload.userId);
            // Acknowledge on the channel that delivered this message.
            ch.ack(msg);
        } catch (error) {
            console.error("Failed to process user.registered event:", error);
            // Temporary policy: leave failures unacknowledged.
            // Delayed retries and dead-letter handling are not implemented yet.
        }
    }, { noAck: false });
}
