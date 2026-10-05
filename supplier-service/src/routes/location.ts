import { Router } from "@oak/oak";
import { createLocation, deleteLocation, fetchAllLocations } from "../controller/location.ts";
import { authenticationMiddleware } from "../middleware/auth.ts";
import { Role } from "../common.ts";
import { validateBody } from "../middleware/schema.ts";
import { createLocationSchema } from "../schema/location.ts";

const router = new Router({ prefix: "/locations" });

// get list of all locations, e.g. for filtering suppliers by building
router.get(
    "/",
    authenticationMiddleware(new Set()),
    fetchAllLocations
);

// create new location
router.post(
    "/",
    authenticationMiddleware(new Set([Role.Admin])),
    validateBody(createLocationSchema),
    createLocation
);

// delete location with specified id, only if no supplier uses it
router.delete(
    "/:id",
    authenticationMiddleware(new Set([Role.Admin])),
    async ctx => {
    await deleteLocation(ctx, Number(ctx.params.id));
})

export default router;
