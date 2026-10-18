import type { RouterContext } from "@oak/oak";
import type { Context } from "@oak/oak";
import { db } from "../prisma/db.ts";
import type { AuthenticatedUser } from "../middleware/auth.ts";
import { isNonEmptyString } from "../util/isNonEmptyString.ts";

function validateErrandId(ctx: Context, id: string): boolean {
    if (!isNonEmptyString(id)) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Errand ID must be a non-empty string" };
        return false;
    }
    return true;
}

export const getBalance = async (ctx: Context, userId: number) => {
    if (!validateErrandId(ctx, userId)) return;
    try {
        const balance = await db.orm.public.UserCredits
            .where({ userId: userId })
            .first();
            ctx.response.status = 200;
            ctx.response.body = balance;

        if (!balance) {
            ctx.response.status = 404;
            ctx.response.body = { error: "User credit balance not found" };
            return;
        }
    } catch (error) {
        console.error("Failed to fetch credits:", error);
        ctx.response.status = 500;
        ctx.response.body = { 
            error: "Internal server error" 
        }
    }
}

export const listTransactions = async (ctx: Context, userId: number) => {
    if (!validateErrandId(ctx, userId)) return;
    try {
        const balance = await db.orm.public.CreditsOnHold
            .where({ requestorId: userId })
            .all();
            ctx.response.status = 200;
            ctx.response.body = balance;
    } catch (error) {
        console.error("Failed to fetch credits:", error);
        ctx.response.status = 500;
        ctx.response.body = { 
            error: "Internal server error" 
        }
    }
}

export const registerUser = async (ctx: Context, userId: number) => {
    if (!validateErrandId(ctx, userId)) return;
    try {
        const userCredits = await db.orm.public.UserCredits.create({
            userId: userId,
            balance: 100
        })
        ctx.response.status = 201;
        ctx.response.body = userCredits;
    } catch (error) {
        if ((error as { sqlState?: string })?.sqlState === "23505") {
            ctx.response.status = 409;
            ctx.response.body = { error: "User credit account already exists" };
            return;
        }
        console.error("Failed to register credit account:", error);
        ctx.response.status = 500;
        ctx.response.body = { error: "Internal server error" };
    }
}

export const releaseCredits = async (ctx: Context, errandId: string) => {
    if (!validateErrandId(ctx, errandId)) return;

    try {
        const result = await db.transaction(async tx => {
            const hold = await tx.orm.public.CreditsOnHold
                .where({ errandId })
                .forUpdate()
                .first();

            if (!hold) {
                ctx.throw(404, "Credit hold not found");
            }
            if (hold.status !== "HELD") {
                ctx.throw(409, "Credit hold has already been settled");
            }
            
            if (hold.courierId === null) {
                ctx.throw(409, "No courier is assigned to this credit hold");
            }

            const credits = await tx.orm.public.UserCredits
                .where({ userId: hold.courierId })
                .forUpdate()
                .first();

            if (!credits) {
                ctx.throw(404, "Supplier credit balance not found");
            }

            const userCredits = await tx.orm.public.UserCredits
                .where({ userId: hold.courierId })
                .update({ balance: credits.balance + hold.amount });

            const releasedHold = await tx.orm.public.CreditsOnHold
                .where({ errandId })
                .update({ status: "RELEASED" });

            return { hold: releasedHold, userCredits };
        });

        ctx.response.status = 200;
        ctx.response.body = result;
    } catch (error) {
        // Preserve HTTP errors such as 404 and 409.
        if (error instanceof Error && "status" in error) {
            throw error;
        }

        console.error("Failed to release credits:", error);
        ctx.response.status = 500;
        ctx.response.body = { error: "Internal server error" };
    }
};

export const refundCredits = async (ctx: Context, errandId: string) => {
    if (!validateErrandId(ctx, errandId)) return;

    try {
        const result = await db.transaction(async tx => {
            const hold = await tx.orm.public.CreditsOnHold
                .where({ errandId })
                .forUpdate()
                .first();

            if (!hold) {
                ctx.throw(404, "Credit hold not found");
            }
            if (hold.status !== "HELD") {
                ctx.throw(409, "Credit hold has already been settled");
            }

            const credits = await tx.orm.public.UserCredits
                .where({ userId: hold.requestorId })
                .forUpdate()
                .first();

            if (!credits) {
                ctx.throw(404, "Requester credit balance not found");
            }

            const userCredits = await tx.orm.public.UserCredits
                .where({ userId: hold.requestorId })
                .update({ balance: credits.balance + hold.amount });

            const refundedHold = await tx.orm.public.CreditsOnHold
                .where({ errandId })
                .update({ status: "REFUNDED" });

            return { hold: refundedHold, userCredits };
        });

        ctx.response.status = 200;
        ctx.response.body = result;
    } catch (error) {
        // Preserve HTTP errors such as 404 and 409.
        if (error instanceof Error && "status" in error) {
            throw error;
        }

        console.error("Failed to refund credits:", error);
        ctx.response.status = 500;
        ctx.response.body = { error: "Internal server error" };
    }
};

export const createTransaction = async (ctx: Context) => {
    let body;
    try {
        body = await ctx.request.body.json();
    } catch {
        ctx.response.status = 400;
        ctx.response.body = { error: "Request expected JSON body" };
        return;
    }

    if (!body || !isNonEmptyString(body.errandId) || [body.requesterId, body.supplierId, body.amount]
        .some(value => !Number.isInteger(value) || value <= 0 || value > 2_147_483_647)) {
        ctx.response.status = 400;
        ctx.response.body = { error: "errandId must be a non-empty string; requesterId, supplierId and amount must be positive PostgreSQL integers" };
        return;
    }

    const { errandId, requesterId, supplierId, amount } = body;

    try {
        const result = await db.transaction(async tx => {
            const credits = await tx.orm.public.UserCredits
                .where({ userId: requesterId })
                .forUpdate()
                .first();

            if (!credits) {
                ctx.throw(404, "Requester credit balance not found");
            }

            const existingHold = await tx.orm.public.CreditsOnHold
                .where({ errandId })
                .first();
            if (existingHold) {
                ctx.throw(409, "A credit hold already exists for this errand");
            }
            if (credits.balance < amount) {
                ctx.throw(409, "Insufficient credits");
            }

            const supplierCredits = await tx.orm.public.UserCredits
                .where({ userId: supplierId })
                .first();
            if (!supplierCredits) {
                ctx.throw(404, "Supplier credit balance not found");
            }

            const hold = await tx.orm.public.CreditsOnHold.create({
                errandId,
                requestorId: requesterId,
                courierId: supplierId,
                amount,
                status: "HELD",
            });

            const userCredits = await tx.orm.public.UserCredits
                .where({ userId: requesterId })
                .update({ balance: credits.balance - amount });

            return { hold, userCredits };
        });

        ctx.response.status = 201;
        ctx.response.body = result;
    } catch (error) {
        if (error instanceof Error && "status" in error) {
            throw error;
        }

        console.error("Failed to create credit hold:", error);
        ctx.response.status = 500;
        ctx.response.body = { error: "Internal server error" };
    }
};
