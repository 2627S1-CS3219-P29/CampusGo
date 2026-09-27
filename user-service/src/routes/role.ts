import { Router, type RouterContext } from "@oak/oak";
import RoleRepo from "../prisma/roles.ts";
import { authenticationMiddleware } from "../middleware/auth.ts";
import { RoleController } from "../controller/roles.ts";
import { Role } from "../prisma/common.ts";

const roleController = new RoleController(RoleRepo);
const createRoleRouter = () => {
    const router = new Router({ prefix: "/role" });

    router.get("/", authenticationMiddleware(new Set([Role.Admin])), async ctx => {
        await roleController.listRoles(ctx as RouterContext<"/">);
    });
    return router;
};

export default createRoleRouter;
