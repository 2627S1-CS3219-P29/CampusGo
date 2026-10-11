import amqp from "amqplib";
import config from "../config.ts";
import { TransientReplyQueue } from "./transientReplyQueue.ts";

const DEFAULT_RPC_TIMEOUT = 60 * 1000;
const MAX_RPC_PENDING = 10000;
const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 30000;

export interface IQueueProvider {
    publishEvent(routingKey: string, payload: EventPayload): Promise<void>;
    
    createReplyQueue(opts?: { defaultTimeoutMs?: number, maxPending?: number }): Promise<TransientReplyQueue>;
    replyToRpcCaller(replyTo: string, correlationId: string, payload: Record<string, unknown>): Promise<void>;

    // proxy methods
    consume(...args: Parameters<amqp.ConfirmChannel["consume"]>): ReturnType<amqp.ConfirmChannel["consume"]>;
    ack(...args: Parameters<amqp.ConfirmChannel["ack"]>): ReturnType<amqp.ConfirmChannel["ack"]>;
    nack(...args: Parameters<amqp.ConfirmChannel["nack"]>): ReturnType<amqp.ConfirmChannel["nack"]>;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export type EventPayload = Record<string, any> & AuxPayloadInfo;
interface AuxPayloadInfo {
    eventId?: string,
    type: string,
}

export type ProviderState = "connecting" | "open" | "closed";
export type ProviderStateListener = (state: ProviderState) => void;
export type ChannelSetupHandler = (ch: amqp.ConfirmChannel) => Promise<void>;

export class RabbitMqProvider implements IQueueProvider {
    private url: string;
    private connection: amqp.ChannelModel | null = null;
    private ch: amqp.ConfirmChannel | null = null;
    private channelSetupHandler: ChannelSetupHandler;

    private state: ProviderState = "connecting";
    private reconnectTask: Promise<void> | null = null;
    private onStateChangeListeners = new Set<ProviderStateListener>();
    private replyQueues = new Set<TransientReplyQueue>();

    private closedSignal: Promise<void>;
    private emitClosedSignal: () => void;

    private constructor(url: string, channelSetupHandler: ChannelSetupHandler) {
        this.url = url;
        this.channelSetupHandler = channelSetupHandler;

        const { promise, resolve } = Promise.withResolvers<void>();
        this.closedSignal = promise;
        this.emitClosedSignal = resolve;
    }

    static async connect(url: string, channelSetupHandler: ChannelSetupHandler) {
        const provider = new RabbitMqProvider(url, channelSetupHandler);
        const { connection, ch } = await provider.openChannel();
        await provider.install(connection, ch);
        provider.setState("open");
        return provider;
    }

    /**
     * opens connection with channel and runs channel setup handler.
     * on failure, closes partially opened resources
     */
    private async openChannel(): Promise<{ connection: amqp.ChannelModel; ch: amqp.ConfirmChannel }> {
        const connection = await amqp.connect(this.url);
        try {
            const ch = await connection.createConfirmChannel();
            await this.channelSetupHandler(ch);
            return { connection, ch };
        } catch (e) {
            await connection.close().catch(() => {});
            throw e;
        }
    }

    /** stores connection and channel; attaches necessary handlers to them */
    private async install(connection: amqp.ChannelModel, ch: amqp.ConfirmChannel): Promise<void> {
        this.connection = connection;
        this.ch = ch;
        this.attachListeners(connection, ch);
        for (const rq of this.replyQueues)
            await rq.handleReconnect(ch);
    }

    getState(): ProviderState {
        return this.state;
    }

    /**
    * add listener to be triggered on state change.
    * returns a function to unbind listener
    */
    onStateChange(listener: ProviderStateListener): () => void {
        this.onStateChangeListeners.add(listener);
        return () => { this.onStateChangeListeners.delete(listener); };
    }

    /**
    * add listener to be triggered on state change.
    * returns a function to unbind listener
    */
    waitUntilUp(): Promise<void> {
        if (this.state === "open")
            return Promise.resolve();
        if (this.state === "closed")
            return Promise.reject(new Error("RabbitMqProvider is closed"));
        return new Promise((resolve, reject) => {
            const unbind = this.onStateChange(state => {
                if (state === "open") {
                    unbind();
                    resolve();
                } else if (state === "closed") {
                    unbind();
                    reject(new Error("RabbitMqProvider is closed"));
                }
            });
        });
    }

    waitUntilDown(): Promise<void> {
        if (this.state !== "open")
            return Promise.resolve();
        return new Promise(resolve => {
            const unbind = this.onStateChange(state => {
                if (state !== "open") {
                    unbind();
                    resolve();
                }
            });
        });
    }

    private setState(state: ProviderState): void {
        if (this.state === state || this.state === "closed")
            return;
        this.state = state;
        for (const emit of this.onStateChangeListeners) {
            emit(state);
        }
    }

    private attachListeners(connection: amqp.ChannelModel, ch: amqp.ConfirmChannel): void {
        const onClose = () => {
            // called twice on close (both connection and channel close at same time)
            // avoid closign incorrectly
            if (this.connection === connection)
                this.handleDisconnect();
        };
        connection.on("close", onClose);
        connection.on("error", () => { /* let close event handle this */ });
        ch.on("close", onClose);
        ch.on("error", () => { /* let close event handle this */ });
    }

    private handleDisconnect(): void {
        if (this.state === "closed")
            return;

        this.connection = null;
        this.ch = null;
        for (const rq of this.replyQueues)
            rq.handleDisconnect();
        this.setState("connecting");
        this.scheduleReconnect();
    }

    /** spins up reconnection loop */
    private scheduleReconnect(): void {
        if (this.reconnectTask)
            return;

        this.reconnectTask = (async () => {
            let delay = RECONNECT_BASE_DELAY_MS;
            while (this.state !== "closed") {
                let connection: amqp.ChannelModel | null = null;
                let ch: amqp.ConfirmChannel | null = null;
                try {
                    ({ connection, ch } = await this.openChannel());
                    await this.install(connection, ch);
                    this.setState("open");
                    this.reconnectTask = null;
                    return;
                } catch {
                    this.connection = null;
                    this.ch = null;
                    await ch?.close().catch(() => {});
                    await connection?.close().catch(() => {});
                    // abort task if whole provider is closed
                    await Promise.race([sleep(delay), this.closedSignal]);
                    delay = Math.min(delay * 2, RECONNECT_MAX_DELAY_MS);
                }
            }
            this.reconnectTask = null;
        })();
    }

    async close(): Promise<void> {
        if (this.state === "closed")
            return;
        this.emitClosedSignal();
        this.setState("closed");

        const queues = [...this.replyQueues];
        this.replyQueues.clear();
        await Promise.allSettled(queues.map(rq => rq.close()));

        await this.reconnectTask;
        await this.ch?.close().catch(() => {});
        await this.connection?.close().catch(() => {});
        this.ch = null;
        this.connection = null;
    }

    private ensureChannel(): amqp.ConfirmChannel {
        if (this.state !== "open" || !this.ch)
            throw new Error(`RabbitMqProvider is not connected (state: ${this.state})`);
        return this.ch;
    }

    async createReplyQueue({ defaultTimeoutMs = DEFAULT_RPC_TIMEOUT, maxPending = MAX_RPC_PENDING }: { defaultTimeoutMs?: number, maxPending?: number } = {}): Promise<TransientReplyQueue> {
        const ch = this.ensureChannel();
        const rq = new TransientReplyQueue(ch, defaultTimeoutMs, maxPending);
        await rq.start();
        this.replyQueues.add(rq);
        rq.onClosed(() => { this.replyQueues.delete(rq); });
        return rq;
    }

    async replyToRpcCaller(replyTo: string, correlationId: string, payload: Record<string, unknown>): Promise<void> {
        const ch = this.ensureChannel();
        const encodedPayload = Buffer.from(JSON.stringify(payload));
        await new Promise<void>((res, rej) => {
            ch.sendToQueue(replyTo, encodedPayload, {
                contentType: "application/json",
                correlationId,
                timestamp: Date.now(),
            }, err => (err ? rej(err) : res()));
        });
    }


    async publishEvent(routingKey: string, payload: EventPayload) {
        const ch = this.ensureChannel();
        const encodedPayload = Buffer.from(JSON.stringify(payload));
        await new Promise<void>((res, rej) => {
            ch.publish("app.events", routingKey, encodedPayload, {
                persistent: true,
                contentType: "application/json",
                messageId: payload.eventId ?? crypto.randomUUID(),
                timestamp: Date.now(),
                type: payload.type,
            }, err => (err ? rej(err) : res()));
        });
    }

    consume(...args: Parameters<amqp.ConfirmChannel["consume"]>): ReturnType<amqp.ConfirmChannel["consume"]> {
        return this.ensureChannel().consume(...args);
    }

    ack(...args: Parameters<amqp.ConfirmChannel["ack"]>): ReturnType<amqp.ConfirmChannel["ack"]> {
        return this.ensureChannel().ack(...args);
    }
    
    nack(...args: Parameters<amqp.ConfirmChannel["nack"]>): ReturnType<amqp.ConfirmChannel["nack"]> {
        return this.ensureChannel().nack(...args);
    }
}

const defaultChannelSetup = async (ch: amqp.ConfirmChannel) => {
    // main router: publishes to interested services (which are their own queues)
    await ch.assertExchange("app.events", "topic", { durable: true });
    await ch.assertExchange("app.rpc", "direct", { durable: true });
    await ch.assertExchange("app.dlx", "topic", { durable: true });

    // example of use in another 
    // await this.ch.assertQueue("credit.user-registered", {
    //     durable: true,
    //     // deadLetterExchange: "app.dlx",
    //     // deadLetterRoutingKey: "credit.user-registered.dlq",
    // });
    // await this.ch.bindQueue("credit.user-registered", "app.events", "user.registered");

    await ch.assertQueue("user.rpc", { durable: true });
    await ch.bindQueue("user.rpc", "app.rpc", "user.query");
}

export const buildDefaultProvider = async () => {
    if (!config.rabbitMqConnectionString) {
        throw new Error("rabbitmq connection string not found in config");
    }
    const provider = await RabbitMqProvider.connect(config.rabbitMqConnectionString!, defaultChannelSetup);
    return provider;
}