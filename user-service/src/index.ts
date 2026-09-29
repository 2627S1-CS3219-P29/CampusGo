import { parseArgs } from "@std/cli/parse-args";
import { Application, Router } from "@oak/oak";
import { createAuthRouter, createPrivateAuthRouter } from "./routes/auth.ts";
import { connectDatabase } from "./prisma/db.ts";
import log from "./log.ts";
import { seedEssential } from "./prisma/seed.ts";
import createUserRouter from "./routes/user.ts";
import createRoleRouter from "./routes/role.ts";
import { generateInviteCodeCli } from "./tasks/cli.ts";

const flags = parseArgs(Deno.args, {
    boolean: ["gen-invite"],
    default: { "gen-invite": false },
});

// ensure database is ready so that first request is not slow
// TODO: figure out how to automate setup and database migration in the scripts
await connectDatabase();
await seedEssential();

const createPublicRouter = () => {
    const router = new Router({ prefix: "/public" });
    router.get("/health", ctx => {
        ctx.response.body = "ok";
    });
    router.use(createAuthRouter().routes());
    router.use(createUserRouter().routes());
    router.use(createRoleRouter().routes());
    return router;
};

const createPrivateRouter = () => {
    const router = new Router({ prefix: "/private" });
    router.use(createPrivateAuthRouter().routes());
    return router;
};

const main = (port: number) => {
    const app = new Application();
    
    const publicRouter = createPublicRouter();
    app.use(publicRouter.routes());
    app.use(publicRouter.allowedMethods());
    
    const privateRouter = createPrivateRouter();
    app.use(privateRouter.routes());
    app.use(privateRouter.allowedMethods());
    
    app.listen({ port });
};

if (flags["gen-invite"]) {
    await generateInviteCodeCli();
} else {
    const port = Number(Deno.env.get("PORT") ?? 3000);
    log.info(`starting on port ${port}`);
    main(port);
}
