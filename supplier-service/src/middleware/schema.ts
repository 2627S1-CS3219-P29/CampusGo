import type { Context } from "@oak/oak";
import { z } from "zod";

export const validateQuery = (schema: z.ZodType) =>
    async (ctx: Context, next: () => Promise<unknown>) => {
        const raw = Object.fromEntries(ctx.request.url.searchParams);
        const result = schema.safeParse(raw);
        if (!result.success) {
            ctx.response.status = 400;
            ctx.response.body = {
                error: "invalid query parameters",
                details: z.treeifyError(result.error),
            };
            return;
        }
        ctx.state.validatedQuery = result.data;
        await next();
    };
