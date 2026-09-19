import z, { ZodError } from "zod";
import type { IUserRepository } from "../prisma/users.ts";
import type { RouterContext } from "@oak/oak";
import { applyDbError } from "./common.ts";
import { Role } from "../prisma/roles.ts";
import type { JWTPayload } from "jose";

export class UserController {
    userRepo: IUserRepository;
    // roleRepo: IRoleRepository;
    
    constructor(userRepo: IUserRepository) {
        this.userRepo = userRepo;
    }

    /**
     * If user is not an admin, reject access if they are accessing someone other than themselves
     */
    async getUser(ctx: RouterContext<"/:id">) {
        const { id } = ctx.params;
        const roles = ctx.state.jwtPayload.role as Role[];
        const requestingUserId = parseInt((<JWTPayload>ctx.state.jwtPayload).sub!);
        const idSchema = z.coerce.number().int("expected valid id format");

        let parsedUserId = 0;
        try {
            parsedUserId = idSchema.parse(id);
        } catch (e) {
            ctx.response.status = 400;
            if (e instanceof ZodError) {
                ctx.response.body = { 
                    error: "url schema violation",
                    details: z.treeifyError(e)
                };
            }
            return;
        }

        console.log(requestingUserId, parsedUserId);
        if (requestingUserId !== parsedUserId && !(Role.Admin in roles)) {
            ctx.response.status = 403;
            ctx.response.body = { error: "insufficient permissions to get user" }
            return;
        }

        try {
            const userInfo = await this.userRepo.getUserByIdPublic(parsedUserId);
            if (!userInfo) {
                ctx.response.status = 404;
                ctx.response.body = { error: "no such user" };
                return;
            }
            ctx.response.body = userInfo;
        } catch (e) {
            applyDbError(ctx, e);
        }
    }

}