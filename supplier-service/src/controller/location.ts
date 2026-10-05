import type { Context } from "@oak/oak";
import { db } from "../prisma/db.ts";
import type { CreateLocationBody } from "../schema/location.ts";

export const fetchAllLocations = async (ctx: Context) => {
    try {
        const locations = await db.orm.public.Location
            .all();

        ctx.response.status = 200;
        ctx.response.body = [...locations].sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
        console.error("Failed to fetch locations:", error);
        ctx.response.status = 500;
        ctx.response.body = {
            error: "Internal server error"
        }
    }
}

export const createLocation = async (ctx: Context) => {
    // get validatedBody, returned from validateBody(schema) in routes
    const body = ctx.state.validatedBody as CreateLocationBody;

    try {
        // names are unique ignoring case, matching how the CSV seed looks up buildings
        const locations = await db.orm.public.Location.all();
        const existing = [...locations].find(l => l.name.toLowerCase() === body.name.toLowerCase());
        if (existing) {
            ctx.response.status = 409;
            ctx.response.body = {
                error: "invalid location",
                fields: { name: [`"${existing.name}" already exists`] }
            }
            return;
        }

        const location = await db.orm.public.Location.create({ name: body.name });
        ctx.response.status = 201;
        ctx.response.body = location;
    } catch (error) {
        console.error("Failed to create location:", error);
        ctx.response.status = 500;
        ctx.response.body = {
            error: "Internal server error"
        }
    }
}

export const deleteLocation = async (ctx: Context, id: number) => {
    // check if id is a positive int
    if (!Number.isInteger(id) || id <= 0) {
        ctx.response.status = 400;
        ctx.response.body = {
            error: "Location ID must be a positive integer"
        }
        return;
    }

    try {
        const location = await db.orm.public.Location
            .where({ id: id })
            .first();

        if (!location) {
            ctx.response.status = 404;
            ctx.response.body = {
                error: "Location with specified ID not found"
            }
            return;
        }

        // the supplier foreign key blocks deleting a location that any supplier points at,
        // including soft-deleted ones kept for history
        const { live } = await db.orm.public.Supplier
            .where({ locationId: id, deletedAt: null })
            .aggregate(agg => ({ live: agg.count() }));
        const { all } = await db.orm.public.Supplier
            .where({ locationId: id })
            .aggregate(agg => ({ all: agg.count() }));

        if (all > 0) {
            ctx.response.status = 409;
            ctx.response.body = {
                error: live > 0
                    ? `${location.name} still has ${live} supplier${live === 1 ? "" : "s"}, move or delete them first`
                    : `${location.name} is used by deleted suppliers kept for history, so it can't be deleted`
            }
            return;
        }

        await db.orm.public.Location
            .where({ id: id })
            .delete();

        ctx.response.status = 204;
    } catch (error) {
        console.error("Failed to delete location:", error);
        ctx.response.status = 500;
        ctx.response.body = {
            error: "Internal server error"
        }
    }
}
