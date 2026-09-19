import { db } from "./db.ts";
import log from "../log.ts";
import Constants from "./constants.ts";
import { DbError, ErrorType } from "./common.ts";
import { fromRawRole, fromRawRoleThrows, type RawRoleRecord, type Role } from "./roles.ts";

// export { db };

export type RawUserRecord = typeof db.orm.public.User._row;
export type UserWithRoles = RawUserRecord & { roles: Role[] };

export interface IUserRepository {
    registerUser(email: string, hashedPassword: string): Promise<RawUserRecord>;
    getUserByEmail(email: string): Promise<UserWithRoles | null>;
}

export const registerUser = async (email: string, hashedPassword: string): Promise<RawUserRecord> => {
    try {
        const user = await db.orm.public.User.create({ email, hashedPassword });
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

const repo: IUserRepository = {
    registerUser,
    getUserByEmail,
};
export default repo;    

// export async function listUsers(limit = 10) {
//   await seed();
//   const users = await db.orm.public.User.select("id", "email", "username", "name", "createdAt").limit(limit).all();

//   return users.map((user) => ({
//     id: String(user.id),
//     email: user.email,
//     username: user.username ?? null,
//     name: user.name ?? null,
//     createdAt: user.createdAt,
//   }));
// }

// export type StarterUser = Awaited<ReturnType<typeof listUsers>>[number];
