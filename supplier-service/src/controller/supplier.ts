import type { Context, RouterContext } from "@oak/oak";
import { z } from "zod";
import type { ISupplierRepository } from "../prisma/suppliers.ts";
import { ErrorType, SupplierError } from "../prisma/common.ts";
import { SupplierType } from "../common.ts";
import { checkCrossFieldRules, type SupplierFields, supplierFieldSchemas } from "../util/supplierRules.ts";
import type { IOrderServiceClient } from "../util/orderService.ts";
import type { AuthenticatedUser } from "../middleware/auth.ts";
import config from "../config.ts";
import log from "../log.ts";

const { defaultPageSize, maxPageSize, maxSearchLength } = config.supplier;

// query strings are always text, so coerce and validate here
export const listSuppliersQuerySchema = z.object({
    q: z.string().trim().max(maxSearchLength).optional(),
    // comma separated, e.g. type=store,facility
    type: z.string()
        .transform(s => s.split(",").map(t => t.trim()).filter(t => t.length > 0))
        .pipe(z.array(z.enum(SupplierType)))
        .optional(),
    openNow: z.enum(["true", "false"]).transform(v => v === "true").optional(),
    locationId: z.coerce.number().int().positive().optional(),
    sort: z.enum(["name", "-name"]).default("name"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(maxPageSize).default(defaultPageSize),
}).strict();

export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;

export const supplierIdSchema = z.coerce.number().int().positive();

const { name, type, description, locationId, openingHours } = supplierFieldSchemas;

export const createSupplierSchema = z.object({
    name,
    type,
    description: description.default(null),
    locationId: locationId.default(null),
    openingHours: openingHours.default(null),
}).strict().superRefine((s, ctx) => {
    for (const [field, messages] of Object.entries(checkCrossFieldRules(s))) {
        for (const message of messages)
            ctx.addIssue({ code: "custom", path: [field], message });
    }
});

// every field optional; rules spanning fields are checked against the stored supplier
export const updateSupplierSchema = z.object({
    name: name.optional(),
    type: type.optional(),
    description: description.optional(),
    locationId: locationId.optional(),
    openingHours: openingHours.optional(),
}).strict().refine(p => Object.keys(p).length > 0, "Nothing to update");

const internalError = (ctx: Context, e: unknown) => {
    log.error(`supplier request failed: ${e} (origin: ${(<Error>e)?.stack})`);
    ctx.response.status = 500;
    ctx.response.body = { error: "unknown error" };
};

const statusOf: Record<ErrorType, number> = {
    [ErrorType.Invalid]: 400,
    [ErrorType.NotFound]: 404,
    [ErrorType.Conflict]: 409,
};

const applyError = (ctx: Context, e: unknown) => {
    if (e instanceof SupplierError) {
        ctx.response.status = statusOf[e.type];
        ctx.response.body = e.fields ? { error: e.message, fields: e.fields } : { error: e.message };
        return;
    }
    internalError(ctx, e);
};

const parseId = (ctx: RouterContext<"/:id">): number | null => {
    const id = supplierIdSchema.safeParse(ctx.params.id);
    if (id.success)
        return id.data;
    ctx.response.status = 400;
    ctx.response.body = { error: "supplier id must be a positive integer" };
    return null;
};

const actorOf = (ctx: Context) => (<AuthenticatedUser>ctx.state.user).id;

export class SupplierController {
    supplierRepo: ISupplierRepository;
    orderService: IOrderServiceClient;

    constructor(supplierRepo: ISupplierRepository, orderService: IOrderServiceClient) {
        this.supplierRepo = supplierRepo;
        this.orderService = orderService;
    }

    /**
     * Admin-only: create a supplier, responds with the created supplier
     */
    async createSupplier(ctx: RouterContext<"/">) {
        const fields = <SupplierFields>ctx.state.validatedBody;
        try {
            const id = await this.supplierRepo.createSupplier(fields, actorOf(ctx));
            ctx.response.status = 201;
            ctx.response.headers.set("Location", `${ctx.request.url.pathname.replace(/\/$/, "")}/${id}`);
            ctx.response.body = await this.supplierRepo.findSupplierById(id);
        } catch (e) {
            applyError(ctx, e);
        }
    }

    /**
     * Admin-only: change some fields of a supplier, responds with the updated supplier
     */
    async updateSupplier(ctx: RouterContext<"/:id">) {
        const id = parseId(ctx);
        if (id === null)
            return;
        const patch = <Partial<SupplierFields>>ctx.state.validatedBody;
        try {
            await this.supplierRepo.updateSupplier(id, patch, actorOf(ctx));
            ctx.response.body = await this.supplierRepo.findSupplierById(id);
        } catch (e) {
            applyError(ctx, e);
        }
    }

    /**
     * Admin-only: soft delete a supplier, and everything located at it if it is a landmark
     */
    async deleteSupplier(ctx: RouterContext<"/:id">) {
        const id = parseId(ctx);
        if (id === null)
            return;
        try {
            const deletedIds = await this.supplierRepo.deleteSupplier(id, actorOf(ctx), async ids =>
                await this.orderService.hasOngoingErrands(ids)
                    ? "an errand for this supplier is still ongoing, try again once it has finished"
                    : null
            );
            ctx.response.body = { deletedIds };
        } catch (e) {
            applyError(ctx, e);
        }
    }

    /**
     * Any signed-in user: list live suppliers, with optional search, filters, sort and pagination
     */
    async listSuppliers(ctx: RouterContext<"/">) {
        const query = <ListSuppliersQuery>ctx.state.validatedQuery;
        try {
            const result = await this.supplierRepo.listSuppliers({
                search: query.q || undefined,
                types: query.type,
                openNow: query.openNow,
                locationId: query.locationId,
                sortDescending: query.sort === "-name",
                page: query.page,
                pageSize: query.pageSize,
            });
            ctx.response.body = {
                ...result,
                totalPages: Math.ceil(result.total / result.pageSize),
            };
        } catch (e) {
            internalError(ctx, e);
        }
    }

    /**
     * Get one supplier by id. Deleted suppliers are only visible to other
     * services through the private router, e.g. for past errands
     */
    async getSupplier(ctx: RouterContext<"/:id">, includeDeleted = false) {
        const id = supplierIdSchema.safeParse(ctx.params.id);
        if (!id.success) {
            ctx.response.status = 400;
            ctx.response.body = { error: "supplier id must be a positive integer" };
            return;
        }
        try {
            const supplier = await this.supplierRepo.findSupplierById(id.data, includeDeleted);
            if (!supplier) {
                ctx.response.status = 404;
                ctx.response.body = { error: "supplier not found" };
                return;
            }
            ctx.response.body = supplier;
        } catch (e) {
            internalError(ctx, e);
        }
    }
}
