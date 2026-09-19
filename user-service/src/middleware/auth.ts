import type { RouterContext } from "@oak/oak";
import { validateAccessToken } from "../util/jwt.ts";
import { fromRawRole, type Role } from "../prisma/roles.ts";

/**
 * Chcecks if user roles has enough to cover everything in rolesRequired.
 * Behaviour: if user roles somehow contains a role that is not in the system
 * but is not in rolesRequired, as long as user roles are a superset of rolesRequired,
 * we accept it
 */
const checkSufficientPrivileges = (rolesRequired: ReadonlySet<Role>, userRoles: Role[]) => {
    return rolesRequired.difference(new Set(userRoles)).size === 0;
}

export const authenticationMiddleware = (rolesRequired: ReadonlySet<Role>) =>
    async <R extends string>(ctx: RouterContext<R>, next: () => Promise<unknown>) => {
        const authHeader = ctx.request.headers.get("authorization");
        if (!authHeader?.startsWith('Bearer ')) {
            ctx.response.status = 401;
            ctx.response.body = { error: "missing bearer token" };
            await next();
            return;
        }

        const bearerToken = authHeader.slice("Bearer ".length).trim();
        const validationResult = await validateAccessToken(bearerToken);
        if (!validationResult.success) {
            ctx.response.status = 401;
            switch (validationResult.error) {
                case "EXPIRED":
                    ctx.response.body = { error: "access token expired" };
                    break;
                case "INVALID":
                    ctx.response.body = { error: "access token is of invalid format" };
                    break;
            }
            return;
        } else {
            const userRoles = <string[]>validationResult.payload.role ?? [];
            const parsedRoles = userRoles.map(fromRawRole).filter(r => r !== null);
            const isAuthorisedAction = checkSufficientPrivileges(rolesRequired, parsedRoles);
            validationResult.payload.role = parsedRoles; // now this is actually ensured to be valid
            
            ctx.state.jwtPayload = validationResult.payload;
            if (!isAuthorisedAction) {
                ctx.response.status = 403;
                ctx.response.body = { error: "insufficient permissions to perform action" };
                return;
            }
        }
        await next();
    };