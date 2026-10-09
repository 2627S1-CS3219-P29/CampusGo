import type { DbTxUnion } from "./db.ts";
import type { IInviteRepository } from "./invite.ts";
import type { IRoleRepository } from "./roles.ts";
import type { IUserRepository } from "./users.ts";
import RoleRepo from "../prisma/roles.ts";
import InviteRepo from "../prisma/invite.ts";
import UserRepo from "../prisma/users.ts";
import { OutboxRepository, type IOutboxRepository } from "./outbox.ts";

export interface Repos {
    invite: IInviteRepository;
    role: IRoleRepository;
    user: IUserRepository;
    outbox: IOutboxRepository;
}

export interface IRepoFactory {
    buildRepos(db: DbTxUnion): Repos;
}

class RepoFactory implements IRepoFactory {
    buildRepos(db: DbTxUnion): Repos {
        // TODO: refactor other repos to use this pattern
        return {
            invite: InviteRepo,
            role: RoleRepo,
            user: UserRepo,
            outbox: new OutboxRepository(db),
        };
    }
}

export const repoFactory = new RepoFactory();