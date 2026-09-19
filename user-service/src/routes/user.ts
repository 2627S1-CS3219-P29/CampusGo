import { Router } from "@oak/oak";
import UserRepo from "../prisma/users.ts";
import { UserController } from "../controller/user.ts"
import { authenticationMiddleware } from "../middleware/auth.ts";

const userController = new UserController(UserRepo);
const createUserRouter = () => {
    const router = new Router({ prefix: "/user" });

    router.get("/:id", authenticationMiddleware(new Set()), async ctx => {
        await userController.getUser(ctx);
    });
    
    return router;
};

export default createUserRouter;