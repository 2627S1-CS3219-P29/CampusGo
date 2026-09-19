import { type RouterContext } from "@oak/oak";
import { z } from "zod";
import { analysePasswordCategories } from "../util/password.ts";
import config from "../config.ts";
import { hashPassword, verifyPassword } from "../util/hash.ts";
// import * as Users from "../prisma/users.ts";
import { type IUserRepository } from "../prisma/users.ts";
import { applyDbError } from "./common.ts";
import { generateJwtTokenPair } from "../util/jwt.ts";
import type { IRoleRepository } from "../prisma/roles.ts";
import log from "../log.ts";

// TODO: clarify if need to be specifically university email
export const registrationSchema = z.object({
    email: z.email('A valid email is required')
        .max(254),
    password: z.string()
        .min(config.password.minLength, `Password must be at least ${config.password.minLength} characters`)
        .refine(
            s => analysePasswordCategories(s).uniqueCategoriesPresent >= config.password.minUniqueCategories,
            `Password must contain at least ${config.password.minUniqueCategories} unique categories`
        )
        .max(128),
});

export const loginSchema = z.object({
    email: z.email('A valid email is required')
        .max(254),
    password: z.string()
        .max(128),
});

const GENERIC_LOGIN_ERROR = "supplied email/password is incorrect";

// TODO: unit testing
export class AuthController {
    userRepo: IUserRepository;
    roleRepo: IRoleRepository;
    
    constructor(userRepo: IUserRepository, roleRepo: IRoleRepository) {
        this.userRepo = userRepo;
        this.roleRepo = roleRepo;
    }

    async registerUser(ctx: RouterContext<"/register">) {
        const body = ctx.state.validatedBody as z.output<typeof registrationSchema>;
        const hashedPassword = await hashPassword(body.password);
        try {
            // FIXME: how to handle transaction with this pattern while still allowing for mocking?
            const registeredUser = await this.userRepo.registerUser(body.email, hashedPassword);
            console.log(registeredUser);
            await this.roleRepo.assignRoles(registeredUser!.id, new Set(config.user.defaultRoles));
            ctx.response.body = "registration success";
        } catch (e) {
            applyDbError(ctx, e);
        }
    }

    async login(ctx: RouterContext<"/login">) {
        const body = ctx.state.validatedBody as z.output<typeof loginSchema>;
        try {
            const user = await this.userRepo.getUserByEmail(body.email);
            // TODO: log failures to induce account timeout
            if (!user) {
                // email was not in the system
                ctx.response.status = 401;
                ctx.response.body = GENERIC_LOGIN_ERROR;
                return;
            }
            const doesPwMatch = await verifyPassword(user.hashedPassword, body.password);
            if (!doesPwMatch) {
                ctx.response.status = 401;
                ctx.response.body = GENERIC_LOGIN_ERROR;
                return;
            }

            const tokens = await generateJwtTokenPair(user.id.toString(), user.roles);
            ctx.response.body = tokens;
        } catch (e) {
            applyDbError(ctx, e);
        }
    }

    // TODO: /refresh: query refresh token in database and check if blacklisted. if ok, refresh both tokens
    // TODO: /logout: blacklist refresh token, let access token expire
}
