import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { spy, stub } from "@std/testing/mock";
import { UserController } from "../src/controller/user.ts";
import { FakeCtx, makeRoleRepo, makeUserRepo } from "./util.ts";
import { JWTPayload } from "jose";
import { IRoleRepository } from "../src/prisma/roles.ts";
import { IUserRepository } from "../src/prisma/users.ts";
import { Role } from "../src/prisma/common.ts";

// TODO: test updateUserBasic

describe("UserController.getUser", () => {
    const adminPayload: JWTPayload = { sub: "1", role: [Role.Admin] };
    const userPayload: JWTPayload = { sub: "2", role: [Role.Requestor] };
    const publicUser = {
        id: 2,
        email: "a@b.com",
        nickname: "A",
        contact: null,
        createdAt: "",
        roles: [Role.Requestor],
    };

    it("returns 400 for invalid id", async () => {
        const controller = new UserController(makeUserRepo(), {} as never, {} as never);
        const ctx = new FakeCtx({
            params: { id: "abc" },
            jwtPayload: adminPayload,
        });

        await controller.getUser(ctx.asCtx());

        assertEquals(ctx.response.status, 400);
    });

    it("returns 403 when non-admin requests another user", async () => {
        const controller = new UserController(makeUserRepo(), {} as never, {} as never);
        const ctx = new FakeCtx({
            params: { id: "3" },
            jwtPayload: userPayload,
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
            params: { id: "2" },
            jwtPayload: userPayload,
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
            params: { id: "3" },
            jwtPayload: adminPayload,
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
            params: { id: "9" },
            jwtPayload: adminPayload,
        });

        await controller.getUser(ctx.asCtx());

        assertEquals(ctx.response.status, 404);
        assertEquals(ctx.response.body, { error: "no such user" });
    });
});

describe("UserController.updateUserRole", () => {
    const adminPayload: JWTPayload = { sub: "1", role: [Role.Admin] };
    const userPayload: JWTPayload  = { sub: "2", role: [Role.Requestor] };

    it("rejects non-admin editing someone else", async () => {
        const userController = new UserController(makeUserRepo(), {} as never, {} as never);
        const ctx = new FakeCtx({
            params: { id: "3" },
            jwtPayload: userPayload,
            validatedBody: { [Role.Courier]: true },
        });

        await userController.updateUserRole(ctx.asCtx());
        assertEquals(ctx.response.status, 403);
    });

    it("rejects self edit admin role", async () => {
        const userController = new UserController(makeUserRepo(), {} as never, {} as never);
        const ctx = new FakeCtx({
            params: { id: "1" },
            jwtPayload: adminPayload,
            validatedBody: { [Role.Admin]: false },
        });

        await userController.updateUserRole(ctx.asCtx());
        assertEquals(ctx.response.status, 403);
    });

    it("admin can grant admin to another user", async () => {
        const roleRepo  = {
            assignRoles: spy(async () => {}),
            removeRoles: spy(async () => {}),
        };
        const userRepo: Partial<IUserRepository> = {
            // should not care about the value
            getUserByIdPublic: spy(async (_id: number) => ({} as never))
        };
        const userController = new UserController(makeUserRepo(userRepo), makeRoleRepo(roleRepo), {} as never);
        const ctx = new FakeCtx({
            params: { id: "9" },
            jwtPayload: adminPayload,
            validatedBody: { [Role.Admin]: true },
        });

        await userController.updateUserRole(ctx.asCtx());

        assertEquals(ctx.response.body, "updated");
        assertEquals(roleRepo.assignRoles.calls[0].args, [9, new Set([Role.Admin])]);
        assertEquals(roleRepo.removeRoles.calls.length, 0);
    });
});
