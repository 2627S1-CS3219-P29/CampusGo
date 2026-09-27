// AI assistance (27/9/2026): deepseek
// generated unit tests given mock functions and example tests. picked, cleaned up code and added some missing tests on top

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { spy } from "@std/testing/mock";
import { validateBody } from "../src/middleware/schema.ts";
import { CtxOpts, FakeCtx, makeJwtService } from "./util.ts";
import { JWTPayload } from "jose";
import { Role } from "../src/prisma/common.ts";
import { ValidationResult } from "../src/util/jwt.ts";
import { authenticationMiddlewareWithJwtProvider } from "../src/middleware/auth.ts";import z from "zod";

const makeAuthCtx = (opts: CtxOpts = {}) => new FakeCtx({
    ...opts,
    headers: { ...opts.headers, authorization: `Bearer atoken` }
});

describe("authentication middleware", () => {
    const mockNext = () => spy(async (_ctx?: unknown) => {});

    it("returns 401 when authorization header is missing", async () => {
        const mw = authenticationMiddlewareWithJwtProvider(makeJwtService(), new Set());
        const ctx = new FakeCtx();
        const next = mockNext();

        await mw(ctx.asCtx(), next);

        assertEquals(ctx.response.status, 401);
        assertEquals(ctx.response.body, { error: "missing bearer token" });
        assertEquals(next.calls.length, 0);
    });

    it("returns 401 when authorization is not a Bearer token", async () => {
        const mw = authenticationMiddlewareWithJwtProvider(makeJwtService(), new Set());
        const ctx = new FakeCtx({ headers: { authorization: "not a bearer" } });
        const next = mockNext();

        await mw(ctx.asCtx(), next);

        assertEquals(ctx.response.status, 401);
        assertEquals(ctx.response.body, { error: "missing bearer token" });
        assertEquals(next.calls.length, 0);
    });

    it("returns 401 when the access token is expired", async () => {
        const jwtService = makeJwtService({
            validateAccessToken: async () =>
                ({ success: false, error: "EXPIRED" }) as never,
        });
        const mw = authenticationMiddlewareWithJwtProvider(jwtService, new Set());
        const ctx = makeAuthCtx();
        const next = mockNext();

        await mw(ctx.asCtx(), next);

        assertEquals(ctx.response.status, 401);
        assertEquals(ctx.response.body, { error: "access token expired" });
        assertEquals(next.calls.length, 0);
    });

    it("returns 401 when the access token is invalid", async () => {
        const jwtService = makeJwtService({
            validateAccessToken: async () => ({ success: false, error: "INVALID" }),
        });
        const mw = authenticationMiddlewareWithJwtProvider(jwtService, new Set());
        const ctx = makeAuthCtx();
        const next = mockNext();

        await mw(ctx.asCtx(), next);

        assertEquals(ctx.response.status, 401);
        assertEquals(ctx.response.body, { error: "access token is of invalid format" });
        assertEquals(next.calls.length, 0);
    });

    it("returns 403 when the user lacks a required role", async () => {
        const jwtService = makeJwtService({
            validateAccessToken: async () => ({ success: true, payload: { sub: "1", role: [] } }) as never
        });
        const mw = authenticationMiddlewareWithJwtProvider(jwtService, new Set([Role.Admin]));
        const ctx = makeAuthCtx();
        const next = mockNext();

        await mw(ctx.asCtx(), next);

        assertEquals(ctx.response.status, 403);
        assertEquals(ctx.response.body, { error: "insufficient permissions to perform action" });
        assertEquals(next.calls.length, 0);
    });

    it("calls next and populates ctx.state.jwtPayload when roles suffice", async () => {
        const validRoles = [Role.Admin, Role.Courier];
        const jwtService = makeJwtService({
            validateAccessToken: async () => ({ success: true, payload: { sub: "1", role: validRoles } }) as never
        });
        const mw = authenticationMiddlewareWithJwtProvider(jwtService, new Set([Role.Admin]));
        const ctx = makeAuthCtx();
        const next = mockNext();

        await mw(ctx.asCtx(), next);

        const payload = ctx.state.jwtPayload as JWTPayload;
        assertEquals(payload.sub, "1");
        assertEquals(payload.role, validRoles);
        assertEquals(next.calls.length, 1);
    });

    it("drops unknown roles from the raw payload", async () => {
        const validRoles = [Role.Admin, Role.Courier];
        const jwtWithInvalidRole: ValidationResult = {
            success: true,
            payload: { sub: "1", role: [...validRoles, "something invalid"] },
        } as never;
        const jwtService = makeJwtService({
            validateAccessToken: async () => jwtWithInvalidRole,
        });
        const mw = authenticationMiddlewareWithJwtProvider(jwtService, new Set());
        const ctx = makeAuthCtx();
        const next = mockNext();

        await mw(ctx.asCtx(), next);

        assertEquals(next.calls.length, 1);
        assertEquals((ctx.state.jwtPayload as JWTPayload).role, validRoles);
    });
});

describe("body schema validation middleware", () => {
    const schema = z.object({ name: z.string() });

    it("returns 400 when the request has no body", async () => {
        const mw = validateBody(schema);
        const ctx = new FakeCtx();
        const next = spy(async () => {});

        await mw(ctx.asCtx(), next);

        assertEquals(ctx.response.status, 400);
        assertEquals(ctx.response.body, { error: "request body expected" });
        assertEquals(next.calls.length, 0);
    });

    it("returns 400 when the body is invalid json", async () => {
        const mw = validateBody(schema);
        const ctx = new FakeCtx({ bodyJson: new Error("invalid json") });
        const next = spy(async () => {});

        await mw(ctx.asCtx(), next);

        assertEquals(ctx.response.status, 400);
        assertEquals(ctx.response.body, { error: "request expected json body" });
        assertEquals(next.calls.length, 0);
    });

    it("returns 400 with details when schema validation fails", async () => {
        const mw = validateBody(schema);
        const ctx = new FakeCtx({ bodyJson: { name: 123 } });
        const next = spy(async () => {});

        await mw(ctx.asCtx(), next);

        assertEquals(ctx.response.status, 400);
        const body = ctx.response.body as { error: string; details?: unknown };
        assertEquals(body.error, "request schema violation");
        assertEquals(typeof body.details, "object");
        assertEquals(next.calls.length, 0);
    });

    it("stores the parsed body and transitions to next middleware", async () => {
        const mw = validateBody(schema);
        const ctx = new FakeCtx({ bodyJson: { name: "hello" } });
        const next = spy(async () => {});

        await mw(ctx.asCtx(), next);

        assertEquals(next.calls.length, 1);
        assertEquals(ctx.state.validatedBody, { name: "hello" });
        assertEquals(ctx.response.status, 200);
    });
});
