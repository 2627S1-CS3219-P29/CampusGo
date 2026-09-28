import type { Context, RouterContext } from "@oak/oak";
import { z } from "zod";
import type { ISupplierRepository } from "../prisma/suppliers.ts";
import { SupplierType } from "../common.ts";
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

const internalError = (ctx: Context, e: unknown) => {
    log.error(`supplier request failed: ${e} (origin: ${(<Error>e)?.stack})`);
    ctx.response.status = 500;
    ctx.response.body = { error: "unknown error" };
};

export class SupplierController {
    supplierRepo: ISupplierRepository;

    constructor(supplierRepo: ISupplierRepository) {
        this.supplierRepo = supplierRepo;
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
