import * as jose from "jose";
import config from "../config.ts";
import type { Role } from "../prisma/roles.ts";

type KeyBytes = Uint8Array<ArrayBuffer>;

// Private keys (Auth Service only) used to SIGN tokens
const accessKey = await new TextEncoder().encode(config.jwt.accessKey);
const refreshKey = await new TextEncoder().encode(config.jwt.refreshKey);

/**
 * Generates a pair of JWT tokens (Access and Refresh) for a user.
 *
 * @param userId - The unique identifier of the user being authenticated.
 * @param userRoles - Array of string roles assigned to the user (embedded in accessToken).
 * @returns Object containing both the Access Token and Refresh Token.
 */
export async function generateJwtTokenPair(userId: string, userRoles: Role[]) {
    const accessToken = await new jose.SignJWT({ role: userRoles })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(userId)
        .setIssuer(config.jwt.issuer)
        .setIssuedAt()
        // .setExpirationTime(config.jwt.accessTtl)
        .setExpirationTime("1s")
        .sign(accessKey);

    const refreshToken = await new jose.SignJWT({ tokenType: 'refresh' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(userId)
        .setIssuer(config.jwt.issuer)
        .setIssuedAt()
        .setExpirationTime(config.jwt.refreshTtl)
        .sign(refreshKey);

    return { accessToken, refreshToken };
}

type ValidationResult =
    { success: true; payload: jose.JWTPayload; protectedHeader: jose.JWTHeaderParameters } |
    { success: false; error: 'EXPIRED' | 'INVALID' };

const tokenValidationHelper = async (token: string, key: KeyBytes): Promise<ValidationResult> => {
    try {
        const res = await jose.jwtVerify(token, key, {
            algorithms: ['HS256']
        });
        return { success: true, ...res };
    } catch (e) {
        if (e instanceof jose.errors.JWTExpired) {
            return { success: false, error: 'EXPIRED' };
        }
        return { success: false, error: 'INVALID' };
    }
};

export function validateAccessToken(token: string): Promise<ValidationResult> {
    return tokenValidationHelper(token, accessKey);
}

export function validateRefreshToken(token: string): Promise<ValidationResult> {
    return tokenValidationHelper(token, refreshKey);
}
