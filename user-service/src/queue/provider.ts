import amqp from "amqplib";
import config from "../config.ts";

interface IQueueProvider {
    
}

export type EventPayload = Record<string, any> & AuxPayloadInfo;
interface AuxPayloadInfo {
    eventId?: string,
    type: string,
}

export class RabbitMqProvider implements IQueueProvider {
    connection: amqp.ChannelModel;
    ch: amqp.ConfirmChannel;

    private constructor(connection: amqp.ChannelModel, ch: amqp.ConfirmChannel) {
        this.connection = connection;
        this.ch = ch;
    }

    static async connect(url: string) {
        const connection = await amqp.connect(url);
        const ch = await connection.createConfirmChannel();
        const provider = new RabbitMqProvider(connection, ch);
        await provider.setup();
        return provider;
    }

    private async setup() {
        // main router: publishes to interested services (which are their own queues)
        await this.ch.assertExchange("app.events", "topic", { durable: true });
        await this.ch.assertExchange("app.rpc", "direct", { durable: true });
        await this.ch.assertExchange("app.dlx", "topic", { durable: true });

        // example of use in another 
        // await this.ch.assertQueue("credit.user-registered", {
        //     durable: true,
        //     // deadLetterExchange: "app.dlx",
        //     // deadLetterRoutingKey: "credit.user-registered.dlq",
        // });
        // await this.ch.bindQueue("credit.user-registered", "app.events", "user.registered");

        await this.ch.assertQueue("user.rpc", { durable: true });
        await this.ch.bindQueue("user.rpc", "app.rpc", "user.query");
    }

    async publishEvent(routingKey: string, payload: EventPayload) {
        const encodedPayload = Buffer.from(JSON.stringify(payload));
        await new Promise<void>((res, rej) => {
            this.ch.publish("app.events", routingKey, encodedPayload, {
                persistent: true,
                contentType: "application/json",
                messageId: payload.eventId ?? crypto.randomUUID(),
                timestamp: Date.now(),
                type: payload.type,
            }, err => {
                if (err)
                    rej(err);
                res();
            });
        });
    }

    consume(...args: Parameters<amqp.Channel["consume"]>): ReturnType<amqp.Channel["consume"]> {
        return this.ch.consume(...args);
    }
}

export const buildDefaultProvider = async () => {
    if (!config.rabbitMqConnectionString) {
        throw new Error("rabbitmq connection string not found in config");
    }
    const provider = await RabbitMqProvider.connect(config.rabbitMqConnectionString!);
    return provider;
}
