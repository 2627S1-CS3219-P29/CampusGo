import type { RouterContext } from "@oak/oak";
import { DbError, ErrorType } from "../prisma/common.ts";
import log from "../log.ts";

export const applyDbError = <R extends string>(ctx: RouterContext<R>, e: unknown) => {
    if (e instanceof DbError) {
        if (!e.isUserFault)
            log.warn(`unknown db error error detected: ${e} (origin: ${e.stack})`)
        ctx.response.status = e.isUserFault ? 400 : 500;
        ctx.response.body = {
            error: e.status != ErrorType.Unknown ? e.message : "unknown error"
        };
        return;
    }
    log.error(`generic error detected: ${e} (origin: ${(<Error>e)?.stack})`)
    ctx.response.status = 500;
    ctx.response.body = { error: "unknown error" };
}