import client from "./http";

export interface LoginResponse {
    accessToken: string;
    refreshToken: string;
}

export async function login(email: string, password: string) {
    const res = await client.post(
        "/public/auth/login",
        { email, password },
        { shouldSkipAuthHeader: true }
    );
    return res.data as LoginResponse;
}

export async function register(email: string, password: string) {
    await client.post(
        "/public/auth/register",
        { email, password },
        { shouldSkipAuthHeader: true }
    );
}