// AI assistance (27/9/2026): deepseek
// generated unit tests given mock functions and example tests. picked, cleaned up code and added some missing tests on top

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { spy, stub } from "@std/testing/mock";
import { AuthController } from "../src/controller/auth.ts";
import { DEFAULT_TOKEN_PAIR, FakeCtx, makeHasher, makeJwtService, makePublicUser, makeRoleRepo, makeUserRepo, TEST_ADMIN_ID, TEST_EMAIL, TEST_HASHED_PASSWORD, TEST_PASSWORD } from "./util.ts";
import { JWTPayload } from "jose";
import { IRoleRepository } from "../src/prisma/roles.ts";
import { IUserRepository } from "../src/prisma/users.ts";
import { DbError, ErrorType, Role } from "../src/prisma/common.ts";
import config from "../src/config.ts";
import { ValidationResult } from "../src/util/jwt.ts";


const publicUser = makePublicUser(1);
const validJwtTokenResult: ValidationResult = {
    success: true,
    payload: { sub: TEST_ADMIN_ID },
} as never;

const NEW_USER_ID = 10;
const MISSING_EMAIL = "missing@example.com";
const WRONG_PASSWORD = "wrong";
const CORRECT_PASSWORD = "correct";
const INVALID_REFRESH_TOKEN = "invalid token";
const EXPIRED_REFRESH_TOKEN = "expired token";
const VALID_REFRESH_TOKEN = "valid jwt";
const NEW_TOKEN_PAIR = { accessToken: "newAccess", refreshToken: "newRefresh" };

describe("AuthController.registerUser", () => {
    it("registers a user and assigns default roles", async () => {
        const userRepo = makeUserRepo({
            registerUser: spy(async (email: string, hashedPassword: string, nickname: string) => {
                assertEquals(email, TEST_EMAIL);
                assertEquals(hashedPassword, TEST_HASHED_PASSWORD);
                return { id: NEW_USER_ID } as never;
            }),
        });
        const assignRolesSpy = spy(async () => {});
        const roleRepo = makeRoleRepo({ assignRoles: assignRolesSpy });
        const hasher = makeHasher({
            hashPassword: async (pw: string) => `hashed:${pw}`,
        });
        const controller = new AuthController(userRepo, roleRepo, hasher, {} as never);
        const ctx = new FakeCtx({
            validatedBody: { email: TEST_EMAIL, password: TEST_PASSWORD },
        });

        await controller.registerUser(ctx.asCtx());

        assertEquals(ctx.response.body, "registration success");
        assertEquals(assignRolesSpy.calls[0].args, [NEW_USER_ID, new Set(config.user.defaultRoles)]);
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
            validatedBody: { email: TEST_EMAIL, password: TEST_PASSWORD },
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
            validatedBody: { email: MISSING_EMAIL, password: TEST_PASSWORD },
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
            validatedBody: { email: TEST_EMAIL, password: WRONG_PASSWORD },
        });

        await controller.login(ctx.asCtx());

        assertEquals(ctx.response.status, 401);
        assertEquals(ctx.response.body, { error: "supplied email/password is incorrect" });
    });

    it("returns tokens on successful login", async () => {
        const userRepo = makeUserRepo({
            getUserByEmail: spy(async () =>
                ({ id: 1, hashedPassword: "hash", roles: [Role.Admin] } as never)),
        });
        const hasher = makeHasher({
            verifyPassword: async () => true
        });
        const jwtGenTokens = spy(async () => DEFAULT_TOKEN_PAIR);
        const jwtService = makeJwtService({ generateJwtTokenPair: jwtGenTokens });
        const controller = new AuthController(userRepo, makeRoleRepo(), hasher, jwtService);

        const ctx = new FakeCtx({
            validatedBody: { email: TEST_EMAIL, password: CORRECT_PASSWORD },
        });

        await controller.login(ctx.asCtx());

        assertEquals(ctx.response.body, DEFAULT_TOKEN_PAIR);
        assertEquals(jwtGenTokens.calls[0].args, [TEST_ADMIN_ID, [Role.Admin]]);
    });
});

describe("AuthController.refreshToken", () => {
    it("returns 401 when the refresh token is malformed", async () => {
        const jwtService = makeJwtService({
            validateRefreshToken: async () => ({ success: false, error: "INVALID" }),
        });
        const controller = new AuthController(makeUserRepo(), makeRoleRepo(), makeHasher(), jwtService);
        const ctx = new FakeCtx({
            validatedBody: { refreshToken: INVALID_REFRESH_TOKEN },
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
            validatedBody: { refreshToken: EXPIRED_REFRESH_TOKEN },
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
            validatedBody: { refreshToken: VALID_REFRESH_TOKEN },
        });

        await controller.refreshToken(ctx.asCtx());

        assertEquals(ctx.response.status, 500);
        assertEquals(ctx.response.body, {
            error: "server previously issued token with invalid user reference",
        });
    });

    it("returns a fresh token pair on success", async () => {
        const generateJwtTokenPair = spy(async () => NEW_TOKEN_PAIR);
        const jwtService = makeJwtService({
            validateRefreshToken: async () => validJwtTokenResult,
            generateJwtTokenPair,
        });
        const userRepo = makeUserRepo({
            getUserByIdPublic: spy(async () => publicUser),
        });
        const controller = new AuthController(userRepo, makeRoleRepo(), makeHasher(), jwtService);
        const ctx = new FakeCtx({
            validatedBody: { refreshToken: VALID_REFRESH_TOKEN },
        });

        await controller.refreshToken(ctx.asCtx());

        assertEquals(ctx.response.body, NEW_TOKEN_PAIR);
        assertEquals(generateJwtTokenPair.calls[0].args, [String(publicUser.id), [Role.Requestor]]);
    });
});
