import { Application, Router } from "@oak/oak";
import orderRouter from "./routes/order.ts";
import { connectDatabase } from "./prisma/db.ts";
import { expireDueErrands } from "./controller/order.ts";
import config from "./config.ts";
import log from "./log.ts";

const port = Number(Deno.env.get("PORT") ?? 3000);

// ensure database is ready so that first request is not slow
await connectDatabase();

const publicRouter = new Router({ prefix: "/public" });

publicRouter.get("/health", ctx => {
    ctx.response.body = "ok";
});

publicRouter.use(orderRouter.routes());

const privateRouter = new Router({ prefix: "/private" });
// Add private endpoints (service-to-service) here later.

const app = new Application();

app.use(publicRouter.routes());
app.use(publicRouter.allowedMethods());

app.use(privateRouter.routes());
app.use(privateRouter.allowedMethods());

// expire due errands (and refund their requesters) even if nobody opens them
setInterval(() => {
    expireDueErrands().catch(e => log.error(`expiry job failed: ${e}`));
}, config.order.expiry.checkIntervalMs);

log.info(`starting on port ${port}`);
await app.listen({ port });
