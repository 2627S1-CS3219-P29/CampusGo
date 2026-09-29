import UserRepo from "../prisma/users.ts";
import RoleRepo from "../prisma/roles.ts";
import InviteRepo from "../prisma/invite.ts";
import { AuthController } from "../controller/auth.ts";
import { defaultHasher } from "../util/hash.ts";
import { defaultJwtService } from "../util/jwt.ts";
import { defaultInviteCodeGenerator } from "../util/invite.ts";


export const generateInviteCodeCli = async () => {
    const authController = new AuthController(UserRepo, RoleRepo, InviteRepo, defaultHasher, defaultJwtService, defaultInviteCodeGenerator);
    const code = await authController.generateInviteCodeNoCtx();
    console.log(`successfully generated code: ${code}`);
};