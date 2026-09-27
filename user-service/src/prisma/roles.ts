
import log from "../log.ts";
import { DbError, ErrorType, Role } from "./common.ts";
import { db } from "./db.ts";

export type RawRoleRecord = typeof db.orm.public.Role._row;

export interface IRoleRepository {
    findRolesByName(roles: ReadonlySet<Role>): Promise<RoleMapping>;
    assignAdminByInvite(userId: number, code: string): Promise<void>;
    assignRoles(userId: number, roles: ReadonlySet<Role>): Promise<void>;
    removeRoles(userId: number, roles: ReadonlySet<Role>): Promise<void>;
    listRoles(): Promise<Role[]>;
}

type RoleMapping = { [role in Role]?: number };

export function fromRawRole(rawName: string): Role | null {
    return Object.values(Role).find(r => r === rawName) ?? null;
}

export function fromRawRoleThrows(raw: RawRoleRecord): Role {
    if (!raw)
        throw new Error(`no record was specified`);
    const role = fromRawRole(raw!.name);
    if (!role)
        throw new Error(`role record management is inconsistent, cannot find role: ${raw?.name} (${raw?.id})`);
    return role;
};

export const findRolesByName = async (roles: ReadonlySet<Role>): Promise<RoleMapping> => {
    const rolesArray = [...roles];
    const foundRoles = await db.orm.public.Role
        .where(u => u.name.in(rolesArray))
        .all();
    if (foundRoles.length !== roles.size) {
        throw new DbError({
            status: ErrorType.Unknown,
            isUserFault: false,
            message: `unknown role supplied: ${roles}, found: ${foundRoles.map(r => r.name)}`
        });
    }
    // this should never throw unless the database is broken
    try {
        const mapping: RoleMapping = {};
        for (const v of foundRoles) {
            mapping[fromRawRoleThrows(v)] = v.id;
        }
        return mapping;
    } catch (e) {
        throw new DbError({
            status: ErrorType.Unknown,
            isUserFault: false,
            message: `${e}`
        });
    }
};

/**
 * Enforces constraint that:
 *   - user cannot be already an admin
 *   - code is not expired and exists
 *   - code is not already used
 */
export const assignAdminByInvite = async (userId: number, code: string): Promise<void> => {
    const adminRoleId = (await findRolesByName(new Set([Role.Admin]))).admin!;

    try {
        const inviteEntry = await db.orm.public.AdminInviteCode.where({ code }).first();
        if (!inviteEntry) {
            // invalid invite id
            throw new DbError({
                status: ErrorType.NotFound,
                isUserFault: true,
                message: `unknown invite code supplied: ${code}`
            });
        }

        const codeExpiresAt = new Date(inviteEntry.expiresAt);
        const timeNow = Date.now();
        // do not concern ourselves with edge case of expiry after this block, it is reasonable enough behaviour as is
        if (timeNow > codeExpiresAt.getTime()) {
            // expired invite
            throw new DbError({
                status: ErrorType.Custom,
                isUserFault: true,
                message: `supplied code is expired: ${code}`
            });
        }

        const plan = db.raw.sql`
            INSERT INTO "userRole" ("userId", "roleId", "sourceInviteId")
            SELECT ${userId}, ${adminRoleId}, ${inviteEntry.id}
            FROM "adminInviteCode"
            WHERE "adminInviteCode".id = ${inviteEntry.id}
                AND NOT EXISTS (
                    SELECT 1 
                    FROM "userRole"
                    WHERE ("userRole"."userId" = ${userId} AND "userRole"."roleId" = ${adminRoleId})
                        OR "userRole"."sourceInviteId" = ${inviteEntry.id}
                );
        `.affectedCount().build();

        const { affectedRows } = await db.runtime().execute(plan);
        if (affectedRows === 0) {
            // user was either already admin (race condition), or invite was already taken (more likely)
            throw new DbError({
                status: ErrorType.Custom,
                isUserFault: true,
                message: `invite code was either used, or you were already an admin`
            });
        }
    } catch (e) {
        if (e instanceof DbError)
            throw e;
        throw new DbError({
            status: ErrorType.Unknown,
            isUserFault: false,
            message: `unknown error: ${e}`
        });
    }
};

export const assignRoles = async (userId: number, roles: ReadonlySet<Role>): Promise<void> => {
    const desiredRoles = await findRolesByName(roles);

    // number of roles should be very small, this should be fine
    for (const roleId of Object.values(desiredRoles)) {
        try {
            await db.orm.public.UserRole.upsert({
                create: { userId, roleId },
                update: {},
            });
        } catch (e) {
            throw new DbError({
                status: ErrorType.Unknown,
                isUserFault: false,
                message: `unknown error: ${e}`
            });
        }
    }
};

/**
 * Missing role assignments are ignored
 */
export const removeRoles = async (userId: number, roles: ReadonlySet<Role>): Promise<void> => {
    if (roles.size === 0)
        return;

    const desiredRoles = await findRolesByName(roles);
    try {
        for (const roleId of Object.values(desiredRoles)) {
            await db.orm.public.UserRole
                .where({ userId, roleId })
                .delete();
        }
    } catch (e) {
        throw new DbError({
            status: ErrorType.Unknown,
            isUserFault: false,
            message: `unknown error: ${e}`
        });
    }
};

export const listRoles = async (): Promise<Role[]> => {
    try {
        const rawRoles = await db.orm.public.Role.all();
        return rawRoles.map(fromRawRoleThrows);
    } catch (e) {
        throw new DbError({
            status: ErrorType.Unknown,
            isUserFault: false,
            message: `unknown error: ${e}`
        });
    }
};

export const seedRoles = async (): Promise<void> => {
    for (const name of Object.values(Role)) {
        try {
            await db.orm.public.Role.upsert({
                create: { name },
                update: {},
                conflictOn: { name }
            });
        } catch (e) {
            throw new DbError({
                status: ErrorType.Unknown,
                isUserFault: false,
                message: `unknown error: ${e}`
            });
        }
    }
};

const RoleRepo: IRoleRepository = {
    assignRoles,
    findRolesByName,
    listRoles,
    removeRoles,
    assignAdminByInvite,
};
export default RoleRepo;
