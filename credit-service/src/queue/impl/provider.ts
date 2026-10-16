import config from "../../config.ts";
import amqp from "amqplib";
import { RabbitMqProvider } from "../provider.ts";
import { consumeUserRegistered } from "./userRegistered.ts";
import { consumeOrderCreated } from "./orderCreated.ts";
import { consumeOrderReleased } from "./orderReleased.ts";
import { consumeOrderRefunded } from "./orderRefunded.ts";

const defaultChannelSetup = async (ch: amqp.ConfirmChannel) => {
    // main router: publishes to interested services (which are their own queues)
    await ch.assertExchange("app.events", "topic", { durable: true });
    await ch.assertExchange("app.rpc", "direct", { durable: true });
    await ch.assertExchange("app.dlx", "topic", { durable: true });

    await ch.assertQueue("credit.user-registered", 
        { 
            durable: true
            // deadLetterExchange: "app.dlx",
            // deadLetterRoutingKey: "credit.user-registered.dlq",
        });

    await ch.assertQueue("credit.order-created", {
        durable: true,
    });

    await ch.assertQueue("credit.order-released", {
        durable: true,
    });

        await ch.assertQueue("credit.order-refunded", {
        durable: true,
    });

    await ch.bindQueue(
        "credit.order-created",
        "app.events",
        "order.created"
    )

    await ch.bindQueue(
        "credit.order-released",
        "app.events",
        "order.released"
    )

    
    await ch.bindQueue(
        "credit.order-refunded",
        "app.events",
        "order.refunded"
    )

    await ch.bindQueue(
        "credit.user-registered",
        "app.events",
        "user.registered",
    );

    await ch.prefetch(10);
    await consumeUserRegistered(ch);
    await consumeOrderCreated(ch);
    await consumeOrderReleased(ch);
    await consumeOrderRefunded(ch);
}

export const buildDefaultProvider = async () => {
    if (!config.rabbitMqConnectionString) {
        throw new Error("rabbitmq connection string not found in config");
    }
    const provider = await RabbitMqProvider.connect(config.rabbitMqConnectionString!, defaultChannelSetup);
    return provider;
}
