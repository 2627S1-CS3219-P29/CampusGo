import { AuthController } from "../controller/auth.ts";
import { defaultHasher } from "../util/hash.ts";
import { defaultJwtService } from "../util/jwt.ts";
import { defaultInviteCodeGenerator } from "../util/invite.ts";
import { db } from "../prisma/db.ts";
import { repoFactory } from "../prisma/factory.ts";

export const generateInviteCodeCli = async () => {
    const { user, role, invite } = repoFactory.buildRepos(db);
    const authController = new AuthController(user, role, invite, defaultHasher, defaultJwtService, defaultInviteCodeGenerator);
    const code = await authController.generateInviteCodeNoCtx();
    console.log(`successfully generated code: ${code}`);
};