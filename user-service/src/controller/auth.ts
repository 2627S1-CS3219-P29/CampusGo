import { type RouterContext } from "@oak/oak";
import { z } from "zod";
import config from "../config.ts";
import { type IPasswordHash } from "../util/hash.ts";
import { type IUserRepository } from "../prisma/users.ts";
import { applyDbError, commonPasswordSchema } from "./common.ts";
import type { IRoleRepository } from "../prisma/roles.ts";
import { genericJwtHandler } from "../middleware/auth.ts";
import { generateRandomName } from "../util/name.ts";
import type { IJwtService } from "../util/jwt.ts";
import type { IInviteRepository } from "../prisma/invite.ts";
import type { IInviteCodeGenerator } from "../util/invite.ts";
import { Role } from "../prisma/common.ts";
import type { JWTPayload } from "jose";

// TODO: clarify if need to be specifically university email
export const registrationSchema = z.object({
    email: z.email("A valid email is required").max(254).toLowerCase(),
    password: commonPasswordSchema,
});

export const loginSchema = z.object({
    email: z.email("A valid email is required").max(254).toLowerCase(),
    password: z.string().max(128),
});

export const refreshTokenSchema = z.object({
    refreshToken: z.string("Expected refresh token")
});

export const acceptInviteCodeSchema = z.object({
    code: z.string()
});

const GENERIC_LOGIN_ERROR = "supplied email/password is incorrect";

export class AuthController {
    userRepo: IUserRepository;
    roleRepo: IRoleRepository;
    inviteRepo: IInviteRepository;
    hasher: IPasswordHash;
    jwtService: IJwtService;
    inviteGenerator: IInviteCodeGenerator

    constructor(userRepo: IUserRepository, roleRepo: IRoleRepository, inviteRepo: IInviteRepository, hasher: IPasswordHash, jwtService: IJwtService, inviteGenerator: IInviteCodeGenerator) {
        this.userRepo = userRepo;
        this.roleRepo = roleRepo;
        this.inviteRepo = inviteRepo;
        this.hasher = hasher;
        this.jwtService = jwtService;
        this.inviteGenerator = inviteGenerator;
    }

    async registerUser(ctx: RouterContext<"/register">) {
        const body = ctx.state.validatedBody as z.output<typeof registrationSchema>;
        const hashedPassword = await this.hasher.hashPassword(body.password);
        const defaultNickname = generateRandomName();
        try {
            // FIXME: how to handle transaction with this pattern while still allowing for mocking?
            const registeredUser = await this.userRepo.registerUser(body.email, hashedPassword, defaultNickname);
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
                ctx.response.body = { error: GENERIC_LOGIN_ERROR };
                return;
            }
            const doesPwMatch = await this.hasher.verifyPassword(user.hashedPassword, body.password);
            if (!doesPwMatch) {
                ctx.response.status = 401;
                ctx.response.body = { error: GENERIC_LOGIN_ERROR };
                return;
            }

            const tokens = await this.jwtService.generateJwtTokenPair(user.id.toString(), user.roles);
            ctx.response.body = tokens;
        } catch (e) {
            applyDbError(ctx, e);
        }
    }

    async refreshToken(ctx: RouterContext<"/refresh">) {
        const body = ctx.state.validatedBody as z.output<typeof refreshTokenSchema>;

        const reqRefreshToken = await this.jwtService.validateRefreshToken(body.refreshToken);
        const decodedToken = genericJwtHandler(ctx, reqRefreshToken);
        if (!decodedToken)
            return;

        if (!decodedToken.payload.sub || decodedToken.payload.sub.trim().length === 0) {
            ctx.response.status = 500;
            ctx.response.body = { error: "server previously issued malformed token" };
            return;
        }
        const userId = parseInt(decodedToken.payload.sub);

        try {
            const user = await this.userRepo.getUserByIdPublic(userId);
            if (!user) {
                ctx.response.status = 500;
                ctx.response.body = { error: "server previously issued token with invalid user reference" };
                return;
            }

            const tokens = await this.jwtService.generateJwtTokenPair(user.id.toString(), user.roles);
            ctx.response.body = tokens;
        } catch (e) {
            applyDbError(ctx, e);
        }

    }

    async generateInviteCodeNoCtx() {
        // TODO: retry logic
        const { code, expiresAt } = this.inviteGenerator.generateCode(config.adminInviteCodeExpiryTime);
        await this.inviteRepo.generateNewInviteCode(code, expiresAt);
        return code;
    }

    async generateInviteCode(ctx: RouterContext<"/invite">) {
        try {
            const code = await this.generateInviteCodeNoCtx();
            ctx.response.body = code;
        } catch (e) {
            applyDbError(ctx, e);
        }
    }

    /**
     * Any unexpired and unclaimed code will be accepted, provided
     * the requesting user is not already admin (checked eagerly)
     */
    async acceptInviteCode(ctx: RouterContext<string>) {
        const body = ctx.state.validatedBody as z.output<typeof acceptInviteCodeSchema>;
        const roles = ctx.state.jwtPayload.role as Role[];
        const requestingUserId = parseInt((<JWTPayload>ctx.state.jwtPayload).sub!);

        // the model call will also check, but this will give a clearer error message
        const isAdmin = roles.includes(Role.Admin);
        if (isAdmin) {
            ctx.response.status = 403;
            ctx.response.body = { error: "already an admin" };
            return;
        }

        try {
            await this.roleRepo.assignAdminByInvite(requestingUserId, body.code);
            ctx.response.body = "invitation claimed";
        } catch (e) {
            applyDbError(ctx, e);
        }

    }

    // TODO: /logout: blacklist refresh token, let access token expire. also handle in refreshToken
}
