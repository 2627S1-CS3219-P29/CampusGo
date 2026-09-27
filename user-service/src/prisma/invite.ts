import { db } from "./db.ts";
import log from "../log.ts";
import Constants from "./constants.ts";
import { DbError, ErrorType, Role } from "./common.ts";

export interface IInviteRepository {
    generateNewInviteCode(code: string, expiresAt: Date): Promise<void>;
}

export const generateNewInviteCode = async (code: string, expiresAt: Date): Promise<void> => {
    try {
        await db.orm.public.AdminInviteCode.create({ code, expiresAt: expiresAt.toISOString() });
    } catch (e) {
        const ex = e as { sqlState?: string };
        if (ex.sqlState == Constants.uniqueConstraintViolated) {
            // this should be highly unlikely if code has very high entropy (uuid)
            log.warn(`attempt to create duplicate invite code was blocked`);
            throw new DbError({
                status: ErrorType.ConstraintViolation,
                isUserFault: false,
                message: "failed to create, a duplicate invite code exists"
            });
        }
        throw new DbError({
            status: ErrorType.Unknown,
            isUserFault: false,
            message: `unknown error: ${e}`
        });
    }
};

const InviteRepo: IInviteRepository = {
    generateNewInviteCode
};
export default InviteRepo;
