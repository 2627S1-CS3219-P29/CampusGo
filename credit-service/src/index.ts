import { Application, Router } from "@oak/oak";
import { connectDatabase } from "./prisma/db.ts";
import { createPublicCreditRouter } from "./routes/credits.ts";
import { createPrivateCreditRouter } from "./routes/credits.ts";

// Ensure the database is ready before accepting requests.
await connectDatabase();

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
await main(port);
