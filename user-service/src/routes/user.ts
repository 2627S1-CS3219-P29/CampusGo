import { Router, type RouterContext } from "@oak/oak";
import UserRepo from "../prisma/users.ts";
import RoleRepo, { Role } from "../prisma/roles.ts";
import { UserController, userUpdateBasicSchema, userUpdatePasswordSchema, userUpdateRoleSchema } from "../controller/user.ts"
import { authenticationMiddleware } from "../middleware/auth.ts";
import { validateBody } from "../middleware/schema.ts";

const userController = new UserController(UserRepo, RoleRepo);
const createUserRouter = () => {
    const router = new Router({ prefix: "/user" });

    router.get("/", authenticationMiddleware(new Set([Role.Admin])), async ctx => {
        // HACK: ctx typing seems to break only in root path
        await userController.listUsers(ctx as RouterContext<"/">);
    });

    router.get("/:id", authenticationMiddleware(new Set()), async ctx => {
        await userController.getUser(ctx);
    });

    router.put(
        "/:id",
        authenticationMiddleware(new Set()),
        validateBody(userUpdateBasicSchema),
        async ctx => {
            await userController.updateUserBasic(ctx);
        }
    );

    router.patch(
        "/:id/role",
        authenticationMiddleware(new Set()),
        validateBody(userUpdateRoleSchema),
        async ctx => {
            await userController.updateUserRole(ctx);
        }
    );

    router.post(
        "/:id/change-password",
        authenticationMiddleware(new Set()),
        validateBody(userUpdatePasswordSchema),
        async ctx => {
            await userController.updateUserPassword(ctx);
        }
    );
    
    return router;
};

export default createUserRouter;