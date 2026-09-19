import { Application, Router } from "@oak/oak";
import createAuthRouter from "./routes/auth.ts";
import { connectDatabase } from "./prisma/db.ts";
import log from "./log.ts";
import { seedEssential } from "./prisma/seed.ts";
import createUserRouter from "./routes/user.ts";

const port = Number(Deno.env.get("PORT") ?? 3000);
log.info(`starting on port ${port}`);

// ensure database is ready so that first request is not slow
// TODO: figure out how to automate setup and database migration in the scripts
await connectDatabase();
await seedEssential();

const createPublicRouter = () => {
    const router = new Router({ prefix: "/public" });
    router.get("/health", (ctx) => {
        ctx.response.body = "ok";
    });
    router.use(createAuthRouter().routes());
    router.use(createUserRouter().routes());
    return router;
};


const app = new Application();
const publicRouter = createPublicRouter();
app.use(publicRouter.routes());
app.use(publicRouter.allowedMethods());

app.listen({ port });
