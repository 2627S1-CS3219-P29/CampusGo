// AI assistance (27/9/2026): deepseek
// generated unit tests given mock functions and example tests. picked, cleaned up code and added some missing tests on top

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { spy, stub } from "@std/testing/mock";
import { UserController } from "../src/controller/user.ts";
import { ADMIN_PAYLOAD, FakeCtx, makePublicUser, makeRoleRepo, makeUserRepo, TEST_REQUESTOR_ID, USER_PAYLOAD } from "./util.ts";
import { JWTPayload } from "jose";
import { IRoleRepository } from "../src/prisma/roles.ts";
import { IUserRepository } from "../src/prisma/users.ts";
import { Role } from "../src/prisma/common.ts";

// TODO: test updateUserBasic

const publicUser = makePublicUser(Number(TEST_REQUESTOR_ID));
const OTHER_USER_ID = "3";
const NON_EXISTENT_USER_ID = "9";

describe("UserController.getUser", () => {
    it("returns 400 for invalid id", async () => {
        const controller = new UserController(makeUserRepo(), {} as never, {} as never);
        const ctx = new FakeCtx({
            params: { id: "abc" },
            jwtPayload: ADMIN_PAYLOAD,
        });

        await controller.getUser(ctx.asCtx());

        assertEquals(ctx.response.status, 400);
    });

    it("returns 403 when non-admin requests another user", async () => {
        const controller = new UserController(makeUserRepo(), {} as never, {} as never);
        const ctx = new FakeCtx({
            params: { id: OTHER_USER_ID },
            jwtPayload: USER_PAYLOAD,
        });

        await controller.getUser(ctx.asCtx());

        assertEquals(ctx.response.status, 403);
        assertEquals(ctx.response.body, { error: "insufficient permissions to get user" });
    });

    it("allows a user to access their own record", async () => {
        const userRepo = makeUserRepo({
            getUserByIdPublic: spy(async () => publicUser),
        });
        const controller = new UserController(userRepo, {} as never, {} as never);
        const ctx = new FakeCtx({
            params: { id: String(publicUser.id) },
            jwtPayload: USER_PAYLOAD,
        });

        await controller.getUser(ctx.asCtx());

        assertEquals(ctx.response.body, publicUser);
    });

    it("allows an admin to access another user's record", async () => {
        const userRepo = makeUserRepo({
            getUserByIdPublic: spy(async () => publicUser),
        });
        const controller = new UserController(userRepo, {} as never, {} as never);
        const ctx = new FakeCtx({
            params: { id: OTHER_USER_ID },
            jwtPayload: ADMIN_PAYLOAD,
        });

        await controller.getUser(ctx.asCtx());

        assertEquals(ctx.response.body, publicUser);
    });

    it("returns 404 when the user does not exist", async () => {
        const userRepo = makeUserRepo({
            getUserByIdPublic: spy(async () => null),
        });
        const controller = new UserController(userRepo, {} as never, {} as never);
        const ctx = new FakeCtx({
            params: { id: NON_EXISTENT_USER_ID },
            jwtPayload: ADMIN_PAYLOAD,
        });

        await controller.getUser(ctx.asCtx());

        assertEquals(ctx.response.status, 404);
        assertEquals(ctx.response.body, { error: "no such user" });
    });
});

describe("UserController.updateUserRole", () => {
    it("allows editing valid fields on self", async () => {
        const userRepo = makeUserRepo({
            getUserByIdPublic: spy(async () => publicUser),
        });
        const removeRoles = spy(async () => {});
        const assignRoles = spy(async () => {});
        const roleRepo = makeRoleRepo({ removeRoles, assignRoles });
        const userController = new UserController(userRepo, roleRepo, {} as never);
        const ctx = new FakeCtx({
            params: { id: TEST_REQUESTOR_ID },
            jwtPayload: USER_PAYLOAD,
            validatedBody: { [Role.Courier]: false, [Role.Requestor]: true },
        });

        await userController.updateUserRole(ctx.asCtx());
        assertEquals(ctx.response.status, 200);
        assertEquals(removeRoles.calls.length, 1);
        assertEquals(assignRoles.calls.length, 1);
    });

    it("rejects non-admin editing someone else", async () => {
        const userController = new UserController(makeUserRepo(), {} as never, {} as never);
        const ctx = new FakeCtx({
            params: { id: OTHER_USER_ID },
            jwtPayload: USER_PAYLOAD,
            validatedBody: { [Role.Courier]: true },
        });

        await userController.updateUserRole(ctx.asCtx());
        assertEquals(ctx.response.status, 403);
    });

    it("rejects self edit admin role", async () => {
        const userController = new UserController(makeUserRepo(), {} as never, {} as never);
        const ctx = new FakeCtx({
            params: { id: ADMIN_PAYLOAD.sub! },
            jwtPayload: ADMIN_PAYLOAD,
            validatedBody: { [Role.Admin]: false },
        });

        await userController.updateUserRole(ctx.asCtx());
        assertEquals(ctx.response.status, 403);
    });

    it("admin can grant admin to another user", async () => {
        const roleRepo = {
            assignRoles: spy(async () => {}),
            removeRoles: spy(async () => {}),
        };
        const userRepo: Partial<IUserRepository> = {
            getUserByIdPublic: spy(async (_id: number) => ({} as never))
        };
        const userController = new UserController(makeUserRepo(userRepo), makeRoleRepo(roleRepo), {} as never);
        const ctx = new FakeCtx({
            params: { id: NON_EXISTENT_USER_ID },
            jwtPayload: ADMIN_PAYLOAD,
            validatedBody: { [Role.Admin]: true },
        });

        await userController.updateUserRole(ctx.asCtx());

        assertEquals(ctx.response.body, "updated");
        assertEquals(roleRepo.assignRoles.calls[0].args, [Number(NON_EXISTENT_USER_ID), new Set([Role.Admin])]);
        assertEquals(roleRepo.removeRoles.calls.length, 0);
    });
});
