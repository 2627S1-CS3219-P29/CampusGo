import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { spy, stub } from "@std/testing/mock";
import { AuthController } from "../src/controller/auth.ts";
import { FakeCtx, makeHasher, makeJwtService, makeRoleRepo, makeUserRepo } from "./util.ts";
import { JWTPayload } from "jose";
import { IRoleRepository } from "../src/prisma/roles.ts";
import { IUserRepository } from "../src/prisma/users.ts";
import { DbError, ErrorType, Role } from "../src/prisma/common.ts";
import config from "../src/config.ts";
import { ValidationResult } from "../src/util/jwt.ts";

const publicUser = {
    id: 1,
    email: "a@b.com",
    nickname: "A",
    contact: null,
    createdAt: "",
    roles: [Role.Requestor],
};

const validJwtTokenResult: ValidationResult = ({ success: true, payload: { sub: "1" } }) as never;

describe("AuthController.registerUser", () => {
    it("registers a user and assigns default roles", async () => {
        const userRepo = makeUserRepo({
            registerUser: spy(async (email: string, hashedPassword: string, nickname: string) => {
                assertEquals(email, "test@example.com");
                assertEquals(hashedPassword, "hashed:secret123");
                return { id: 42 } as never;
            }),
        });
        const assignRolesSpy = spy(async () => {});
        const roleRepo = makeRoleRepo({ assignRoles: assignRolesSpy });
        const hasher = makeHasher({
            hashPassword: async (pw: string) => `hashed:${pw}`,
        });
        const controller = new AuthController(userRepo, roleRepo, hasher, {} as never);
        const ctx = new FakeCtx({
            validatedBody: { email: "test@example.com", password: "secret123" },
        });

        await controller.registerUser(ctx.asCtx());

        assertEquals(ctx.response.body, "registration success");
        assertEquals(assignRolesSpy.calls[0].args, [42, new Set(config.user.defaultRoles)]);
    });

    it("returns 400 when email is already registered", async () => {
        const userRepo = makeUserRepo({
            registerUser: spy(async () => {
                throw new DbError({
                    status: ErrorType.ConstraintViolation,
                    isUserFault: true,
                    message: "email is already registered",
                });
            }),
        });
        const roleRepo = makeRoleRepo();
        const hasher = makeHasher();
        const controller = new AuthController(userRepo, roleRepo, hasher, {} as never);
        const ctx = new FakeCtx({
            validatedBody: { email: "a@b.com", password: "secret123" },
        });

        await controller.registerUser(ctx.asCtx());

        assertEquals(ctx.response.status, 400);
        assertEquals(ctx.response.body, { error: "email is already registered" });
    });
});

describe("AuthController.login", () => {
    it("returns 401 when email is not found", async () => {
        const userRepo = makeUserRepo({
            getUserByEmail: spy(async () => null),
        });
        const hasher = makeHasher();
        const controller = new AuthController(userRepo, makeRoleRepo(), hasher, {} as never);
        const ctx = new FakeCtx({
            validatedBody: { email: "missing@example.com", password: "secret" },
        });

        await controller.login(ctx.asCtx());

        assertEquals(ctx.response.status, 401);
        assertEquals(ctx.response.body, { error: "supplied email/password is incorrect" });
    });

    it("returns 401 when password is wrong", async () => {
        const userRepo = makeUserRepo({
            getUserByEmail: spy(async () => ({ id: 1, hashedPassword: "hash", roles: [] } as never)),
        });
        const hasher = makeHasher({
            verifyPassword: async () => false,
        });
        const controller = new AuthController(userRepo, makeRoleRepo(), hasher, {} as never);
        const ctx = new FakeCtx({
            validatedBody: { email: "a@b.com", password: "wrong" },
        });

        await controller.login(ctx.asCtx());

        assertEquals(ctx.response.status, 401);
        assertEquals(ctx.response.body, { error: "supplied email/password is incorrect" });
    });

    it("returns tokens on successful login", async () => {
        const tokenPair = { accessToken: "access", refreshToken: "refresh" };
        const userRepo = makeUserRepo({
            getUserByEmail: spy(async () =>
                ({ id: 1, hashedPassword: "hash", roles: [Role.Admin] } as never)),
        });
        const hasher = makeHasher({
            verifyPassword: async () => true
        });
        const jwtGenTokens = spy(async () => tokenPair);
        const jwtService = makeJwtService({ generateJwtTokenPair: jwtGenTokens });
        const controller = new AuthController(userRepo, makeRoleRepo(), hasher, jwtService);

        const ctx = new FakeCtx({
            validatedBody: { email: "a@b.com", password: "correct" },
        });

        await controller.login(ctx.asCtx());

        assertEquals(ctx.response.body, tokenPair);
        assertEquals(jwtGenTokens.calls[0].args, ["1", [Role.Admin]]);
    });
});

describe("AuthController.refreshToken", () => {
    it("returns 401 when the refresh token is malformed", async () => {
        const jwtService = makeJwtService({
            validateRefreshToken: async () => ({ success: false, error: "INVALID" }),
        });
        const controller = new AuthController(makeUserRepo(), makeRoleRepo(), makeHasher(), jwtService);
        const ctx = new FakeCtx({
            validatedBody: { refreshToken: "invalid token" },
        });

        await controller.refreshToken(ctx.asCtx());

        assertEquals(ctx.response.status, 401);
        assertEquals(ctx.response.body, { error: "access token is of invalid format" });
    });

    it("returns 401 when the refresh token is expired", async () => {
        const jwtService = makeJwtService({
            validateRefreshToken: async () => ({ success: false, error: "EXPIRED" }),
        });
        const controller = new AuthController(makeUserRepo(), makeRoleRepo(), makeHasher(), jwtService);
        const ctx = new FakeCtx({
            validatedBody: { refreshToken: "expired token" },
        });

        await controller.refreshToken(ctx.asCtx());

        assertEquals(ctx.response.status, 401);
        assertEquals(ctx.response.body, { error: "access token expired" });
    });

    it("returns 500 when the referenced user no longer exists", async () => {
        const jwtService = makeJwtService({
            validateRefreshToken: async () => validJwtTokenResult,
        });
        const userRepo = makeUserRepo({ getUserByIdPublic: spy(async () => null) });
        const controller = new AuthController(userRepo, makeRoleRepo(), makeHasher(), jwtService);
        const ctx = new FakeCtx({
            validatedBody: { refreshToken: "valid jwt" },
        });

        await controller.refreshToken(ctx.asCtx());

        assertEquals(ctx.response.status, 500);
        assertEquals(ctx.response.body, {
            error: "server previously issued token with invalid user reference",
        });
    });

    it("returns a fresh token pair on success", async () => {
        const tokenPair = { accessToken: "newAccess", refreshToken: "newRefresh" };
        const generateJwtTokenPair = spy(async () => tokenPair);
        const jwtService = makeJwtService({
            validateRefreshToken: async () => validJwtTokenResult,
            generateJwtTokenPair,
        });
        const userRepo = makeUserRepo({
            getUserByIdPublic: spy(async () => publicUser),
        });
        const controller = new AuthController(userRepo, makeRoleRepo(), makeHasher(), jwtService);
        const ctx = new FakeCtx({
            validatedBody: { refreshToken: "valid jwt" },
        });

        await controller.refreshToken(ctx.asCtx());

        assertEquals(ctx.response.body, tokenPair);
        assertEquals(generateJwtTokenPair.calls[0].args, ["1", [Role.Requestor]]);
    });
});
