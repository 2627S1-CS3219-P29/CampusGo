import type { RouterContext } from "@oak/oak";
import type { JWTPayload } from "jose";
import type { IUserRepository } from "../src/prisma/users.ts";
import { IRoleRepository } from "../src/prisma/roles.ts";
import { IPasswordHash } from "../src/util/hash.ts";
import { IJwtService, JwtTokenPair, ValidationResult } from "../src/util/jwt.ts";
import { Role } from "../src/prisma/common.ts";

// mock password hashing
export function makeHasher(overrides: Partial<IPasswordHash> = {}): IPasswordHash {
    return {
        hashPassword: overrides.hashPassword ?? (async (pw: string) => `hashed:${pw}`),
        verifyPassword: overrides.verifyPassword ?? (async () => true),
    };
}

// mock jwt service
export function makeJwtService(overrides: Partial<IJwtService> = {}): IJwtService {
    const DEFAULT_TOKEN_PAIR: JwtTokenPair = { accessToken: "access", refreshToken: "refresh" };
    return {
        generateJwtTokenPair: overrides.generateJwtTokenPair ?? (async () => DEFAULT_TOKEN_PAIR),
        validateAccessToken:
            overrides.validateAccessToken ??
            (async () => ({ success: true, payload: {} }) as unknown as ValidationResult),
        validateRefreshToken:
            overrides.validateRefreshToken ??
            (async () => ({ success: true, payload: {} }) as unknown as ValidationResult),
    };
}

// mock repos
const makeGenericMockRepo = <T>(name: string, overrides: Partial<T> = {}): T => {
    return new Proxy(overrides, {
        get(target, prop) {
            if (prop in target) {
                return Reflect.get(target, prop);
            }
            throw new Error(`mock ${name} repo missing function stub: ${String(prop)}`);
        }
    }) as T;
};

export const makeUserRepo = (overrides: Partial<IUserRepository> = {}): IUserRepository =>
    makeGenericMockRepo("user", overrides);

export const makeRoleRepo = (overrides: Partial<IRoleRepository> = {}): IRoleRepository =>
    makeGenericMockRepo("role", overrides);

// oak request/response context mocking
type CtxOpts = {
    params?: Record<string, string>;
    jwtPayload?: JWTPayload;
    validatedBody?: unknown;
    bodyJson?: unknown | Error;
    headers?: Record<string, string>;
};

/**
 * Mock only the fields that we need as real object is very large
 * Error is thrown if field accessor was for something that was not declared, so that tests will fail fast
 */
export class FakeCtx {
    params: Record<string, string>;
    state: {
        jwtPayload: JWTPayload;
        validatedBody: unknown;
    };
    response: { status: number, body: unknown };
    request: {
        headers: { get: (name: string) => string | null };
        body: unknown | Error;
        hasBody: boolean,
    };

    constructor(opts: CtxOpts = {}) {
        const ctxAccessWrapper = <T extends object>(o: T) => new Proxy(o, {
            get(target, prop) {
                if (prop in target) {
                    return Reflect.get(target, prop);
                }
                throw new Error(`mock oak context missing property: ${String(prop)}`);
            }
        });

        this.params = ctxAccessWrapper(opts.params ?? {});
        this.state = ctxAccessWrapper({
            jwtPayload: opts.jwtPayload ?? {},
            validatedBody: opts.validatedBody,
        });
        this.response = ctxAccessWrapper({ status: 200, body: null as unknown });
        this.request = ctxAccessWrapper({
            headers: {
                get: (name: string) => opts.headers?.[name] ?? null
            },
            body: {
                json: async () => {
                    if (opts.bodyJson instanceof Error)
                        throw opts.bodyJson;
                    return opts.bodyJson;
                },
            },
            hasBody: opts.bodyJson !== undefined,
        });

        return ctxAccessWrapper(this);
    }

    asCtx<R extends string>() {
        return this as unknown as RouterContext<R>;
    }
}
