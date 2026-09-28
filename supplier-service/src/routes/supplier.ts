import { Router, type RouterContext } from "@oak/oak";
import SupplierRepo from "../prisma/suppliers.ts";
import { listSuppliersQuerySchema, SupplierController } from "../controller/supplier.ts";
import { authenticationMiddleware } from "../middleware/auth.ts";
import { validateQuery } from "../middleware/schema.ts";
import { Role } from "../common.ts";

const supplierController = new SupplierController(SupplierRepo);

// write handlers are added with the CRUD work; the guard is already in place
const notImplemented = (ctx: RouterContext<string>) => {
    ctx.response.status = 501;
    ctx.response.body = { error: "not implemented yet" };
};

const createSupplierRouter = () => {
    const router = new Router({ prefix: "/suppliers" });

    // any signed-in user (requestor, courier or admin) can browse suppliers
    router.get("/", authenticationMiddleware(new Set()), validateQuery(listSuppliersQuerySchema), async ctx => {
        // HACK: ctx typing seems to break only in root path
        await supplierController.listSuppliers(ctx as RouterContext<"/">);
    });

    router.get("/:id", authenticationMiddleware(new Set()), async ctx => {
        await supplierController.getSupplier(ctx);
    });

    // only admins manage supplier records (FR 5)
    router.post("/", authenticationMiddleware(new Set([Role.Admin])), notImplemented);
    router.patch("/:id", authenticationMiddleware(new Set([Role.Admin])), notImplemented);
    router.delete("/:id", authenticationMiddleware(new Set([Role.Admin])), notImplemented);

    return router;
};

// reachable only on the gateway's private listener, for other services (e.g. the
// order service looking up the supplier of a past errand)
export const createPrivateSupplierRouter = () => {
    const router = new Router({ prefix: "/suppliers" });

    router.get("/:id", async ctx => {
        await supplierController.getSupplier(ctx, true);
    });

    return router;
};

export default createSupplierRouter;
