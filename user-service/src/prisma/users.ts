import { db } from "./db.ts";
import log from "../log.ts";
import Constants from "./constants.ts";
import { DbError, ErrorType } from "./common.ts";
import { fromRawRole, fromRawRoleThrows, type RawRoleRecord, type Role } from "./roles.ts";

// export { db };

export type RawUserRecord = typeof db.orm.public.User._row;
export type UserWithRoles = RawUserRecord & { roles: Role[] };
export type PublicUserWithRoles = {
    id: number;
    createdAt: string;
    email: string;
    nickname: string;
    contact: string | null;
    roles: Role[];
};

export interface IUserRepository {
    registerUser(email: string, hashedPassword: string, nickname: string): Promise<RawUserRecord>;
    getUserByEmail(email: string): Promise<UserWithRoles | null>;
    getUserByIdPublic(id: number): Promise<PublicUserWithRoles | null>;
    getUserByIdWithPassword(id: number): Promise<UserWithRoles | null>;
    updateUserBasic(id: number, nickname: string, contact: string | null): Promise<RawUserRecord | null>;
    updateUserPassword(id: number, hashedPassword: string): Promise<RawUserRecord | null>;
    listUsers(): Promise<PublicUserWithRoles[]>;
}

const viewProfileValidFields: Parameters<typeof db.orm.public.User.select> = ["id", "email", "createdAt", "nickname", "contact"];

export const registerUser = async (email: string, hashedPassword: string, nickname: string): Promise<RawUserRecord> => {
    try {
        const user = await db.orm.public.User.create({ email, hashedPassword, nickname });
        log.debug(`email was registered: ${email}`);
        return user;
    } catch (e) {
        const ex = e as { sqlState?: string };
        if (ex.sqlState == Constants.uniqueConstraintViolated) {
            log.debug(`duplicate register attempt blocked on email: ${email}`);
            throw new DbError({
                status: ErrorType.ConstraintViolation,
                isUserFault: true,
                message: "email is already registered"
            });
        }
        log.error(`unknown error registering (${email}): ${JSON.stringify(e)}`);
        throw new DbError({
            status: ErrorType.Unknown,
            isUserFault: false,
            message: `unknown error: ${e}`
        })
    }
};

export const getUserByEmail = async (email: string): Promise<UserWithRoles | null> => {
    try {
        const user = await db.orm.public.User.where({ email })
            .include("roles")
            .first();
        if (!user)
            return null
        const roles = user.roles.map(fromRawRoleThrows);
        return { ...user, roles };
    } catch (e) {
        log.error(`unknown error looking up user by email (${email}): ${JSON.stringify(e)}`);
        throw new DbError({
            status: ErrorType.Unknown,
            isUserFault: false,
            message: `unknown error: ${e}`
        })
    }
};

/**
 * Should not return info such as password hashes
 */
export const getUserByIdPublic = async (id: number): Promise<PublicUserWithRoles | null> => {
    try {
        const user = await db.orm.public.User.select(...viewProfileValidFields)
            .where({ id })
            .include("roles")
            .first();
        if (!user)
            return null
        const roles = user.roles.map(fromRawRoleThrows);
        return { ...user, roles };
    } catch (e) {
        log.error(`unknown error looking up user by id (${id}): ${JSON.stringify(e)}`);
        throw new DbError({
            status: ErrorType.Unknown,
            isUserFault: false,
            message: `unknown error: ${e}`
        })
    }
};

/**
 * Updates nickname and contact field
 */
export const updateUserBasic = async (id: number, nickname: string, contact: string | null): Promise<RawUserRecord | null> => {
    try {
        const updatedUser = await db.orm.public.User.where({ id })
            .update({ nickname, contact });
        return updatedUser;
    } catch (e) {
        log.error(`unknown error updating user by id (${id}): ${JSON.stringify(e)}`);
        throw new DbError({
            status: ErrorType.Unknown,
            isUserFault: false,
            message: `unknown error: ${e}`
        })
    }
};

/**
 * Returns full user record including hashedPassword.
 * IMPORTANT: Do not expose this to info to any external client/user
 */
export const getUserByIdWithPassword = async (id: number): Promise<UserWithRoles | null> => {
    try {
        const user = await db.orm.public.User.where({ id })
            .include("roles")
            .first();

        if (!user)
            return null;

        const roles = user.roles.map(fromRawRoleThrows);
        return { ...user, roles };
    } catch (e) {
        log.error(`unknown error looking up user by id with password (${id}): ${JSON.stringify(e)}`);
        throw new DbError({
            status: ErrorType.Unknown,
            isUserFault: false,
            message: `unknown error: ${e}`
        });
    }
};

/**
 * Updates only the password hash.
 */
export const updateUserPassword = async (id: number, hashedPassword: string): Promise<RawUserRecord | null> => {
    try {
        const updatedUser = await db.orm.public.User.where({ id })
            .update({ hashedPassword });
        return updatedUser;
    } catch (e) {
        log.error(`unknown error updating password for user by id (${id}): ${JSON.stringify(e)}`);
        throw new DbError({
            status: ErrorType.Unknown,
            isUserFault: false,
            message: `unknown error: ${e}`
        });
    }
};

/**
 * Lists all users with public fields only.
 */
export const listUsers = async (): Promise<PublicUserWithRoles[]> => {
    try {
        const users = await db.orm.public.User
            .select(...viewProfileValidFields)
            .include("roles")
            .all();

        return users.map(user => ({
            ...user,
            roles: user.roles.map(fromRawRoleThrows),
        }));
    } catch (e) {
        log.error(`unknown error listing users: ${JSON.stringify(e)}`);
        throw new DbError({
            status: ErrorType.Unknown,
            isUserFault: false,
            message: `unknown error: ${e}`
        });
    }
};

const repo: IUserRepository = {
    registerUser,
    getUserByEmail,
    getUserByIdPublic,
    updateUserBasic,
    getUserByIdWithPassword,
    listUsers,
    updateUserPassword,
};
export default repo;    
