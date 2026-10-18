import { Application, Router } from "@oak/oak";
import { connectDatabase, db } from "./prisma/db.ts";
import { createPublicCreditRouter } from "./routes/credits.ts";
import { createPrivateCreditRouter } from "./routes/credits.ts";
import { buildDefaultProvider } from "./queue/impl/provider.ts";
import { makeOutboxWorker } from "./queue/impl/outbox.ts";
import type { RabbitMqProvider } from "./queue/provider.ts";


// Ensure the database is ready before accepting requests.
await connectDatabase();

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const startQueueTasks = async () => {
    const ERROR_BACKOFF_MS = 5000;

    console.debug("initiating queue connection");
    let rabbitMqProvider: RabbitMqProvider | null = null;
    while (!rabbitMqProvider) {
        try {
            rabbitMqProvider = await buildDefaultProvider();
        } catch (e) {
            console.warn(`first connection to queue failed: ${e}`);
            await sleep(ERROR_BACKOFF_MS);
        }
    }
    while (rabbitMqProvider.getState() !== "closed") {
        try {
            console.debug("waiting for queue to go up");
            await rabbitMqProvider.waitUntilUp();
            console.info("queue connection established");
        } catch {
            break;
        }

        const outboxWorker = makeOutboxWorker(db, rabbitMqProvider);
        try {
            outboxWorker.start();

            await rabbitMqProvider.waitUntilDown();
            console.warn("queue is down, stopping all queue workers");
        } catch (e) {
            // Between queue connection and starting the workers, the network may go down.
            console.error(`queue task cycle failed: ${e}`);
            await sleep(ERROR_BACKOFF_MS);
        } finally {
            await outboxWorker.stop();
        }
    }

    await rabbitMqProvider.close();
};

const createPublicRouter = () => {
    const router = new Router({ prefix: "/public" });
    router.get("/health", ctx => {
        ctx.response.body = "ok";
    });
    router.use(createPublicCreditRouter().routes());
    return router;
};

const createPrivateRouter = () => {
    const router = new Router({ prefix: "/private" });
    router.get("/health", ctx => {
        ctx.response.body = "ok";
    });
    router.use(createPrivateCreditRouter().routes());
    return router;
};

const main = async (port: number) => {
    const app = new Application();

    const privateRouter = createPrivateRouter();
    const publicRouter = createPublicRouter();
    app.use(publicRouter.routes());
    app.use(publicRouter.allowedMethods());
    app.use(privateRouter.routes());
    app.use(privateRouter.allowedMethods());

    await app.listen({ port });
};

const port = Number(process.env.PORT ?? 3000);
console.info(`starting on port ${port}`);

startQueueTasks();
await main(port);
