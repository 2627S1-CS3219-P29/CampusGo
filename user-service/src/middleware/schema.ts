import type { Context } from "@oak/oak";
import { z, ZodError } from "zod";

export const validateBody = (schema: z.ZodType) =>
    async (ctx: Context, next: () => Promise<unknown>) => {
        if (!ctx.request.hasBody) {
            ctx.response.status = 400;
            ctx.response.body = { error: "request body expected" };
            return;
        }
    
        try {
            const rawBody = await ctx.request.body.json();
            ctx.state.validatedBody = schema.parse(rawBody);
            await next();
        } catch (err) {
            ctx.response.status = 400;
            if (err instanceof ZodError) {
                ctx.response.body = { 
                    error: "request schema violation",
                    details: z.treeifyError(err)
                };
            } else {
                ctx.response.body = { error: "request expected json body" };
            }
        }
    };

