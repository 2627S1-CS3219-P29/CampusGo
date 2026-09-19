import { Router } from "@oak/oak";
import { validateBody } from "../middleware/schema.ts";
import UserRepo from "../prisma/users.ts";
import RoleRepo from "../prisma/roles.ts";
import { AuthController, loginSchema, refreshTokenSchema, registrationSchema } from "../controller/auth.ts";

const authController = new AuthController(UserRepo, RoleRepo);
const createAuthRouter = () => {
    const router = new Router({ prefix: "/auth" });
    
    router.post("/register", validateBody(registrationSchema), async ctx => {
        await authController.registerUser(ctx);
    });

    router.post("/login", validateBody(loginSchema), async ctx => {
        await authController.login(ctx);
    });
    
    router.post("/refresh", validateBody(refreshTokenSchema), async ctx => {
        await authController.refreshToken(ctx);
    });
    
    return router;
};

export default createAuthRouter;