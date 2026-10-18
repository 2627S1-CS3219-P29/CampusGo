import { db } from "../prisma/db.ts";
import { OutboxRepository } from "../prisma/outbox.ts";

export async function ensureCreditAccount(userId: number): Promise<void> {
    if (!Number.isSafeInteger(userId) || userId <= 0) {
        throw new Error("User ID must be a positive integer");
    }

    // Duplicate deliveries must not reset an existing account's balance.
    // Other database errors propagate to the consumer.
    await db.orm.public.UserCredits.createAll(
        [{ userId, balance: 100 }],
        { onConflict: "skip" },
    );
}

export async function ensureCreditsHeld(errandId: number, requestorId: number, courierId: number, amount: number): Promise<void> {
    try {
        await db.transaction(async tx => {
            const outbox = new OutboxRepository(tx);

            const credits = await tx.orm.public.UserCredits
            .where({userId: requestorId })
            .forUpdate()
            .first()

            if (!credits) {
                await outbox.createEvent("credits.hold.rejected", "creditsHoldRejected", {
                    errandId,
                    reason: "REQUESTOR_NOT_FOUND",
                    occurredAt: new Date().toISOString(),
                });
                // emit new event to order service using rabbitmq
                // errandId, error
                return;
            }

            const existingHold = await tx.orm.public.CreditsOnHold
                .where({ errandId })
                .first();

            if (existingHold) {
                if (
                    existingHold.requestorId !== requestorId ||
                    existingHold.courierId !== courierId ||
                    existingHold.amount !== amount
                ) {
                    await outbox.createEvent("credits.hold.rejected", "creditsHoldRejected", {
                        errandId,
                        reason: "RECORD_NOT_MATCHING",
                        occurredAt: new Date().toISOString(),
                    });
                }

                return; // Already processed; do not deduct again.
            }

            const courierCredits = await tx.orm.public.UserCredits
                .where({userId: courierId })
                .first()

            if (!courierCredits) {
                console.log("Courier credit balance not found")
                // emit new event to order service using rabbitmq
                // errandId, error
                await outbox.createEvent("credits.hold.rejected", "creditsHoldRejected", {
                    errandId,
                    reason: "COURIER_NOT_FOUND",
                    occurredAt: new Date().toISOString(),
                });
                return;
            }

            if (credits.balance < amount) {
                await outbox.createEvent("credits.hold.rejected", "creditsHoldRejected", {
                    errandId,
                    reason: "INSUFFICIENT_CREDITS",
                    occurredAt: new Date().toISOString(),
                });
                return;
            }

            await tx.orm.public.CreditsOnHold.create(
                { errandId, requestorId, courierId, amount, status: "HELD" }
            )

            await tx.orm.public.UserCredits
                .where({ userId: requestorId })
                .update({ balance: credits.balance - amount })

            // emit new event order created successfully
            // errandId
            await outbox.createEvent("credits.held", "creditsHeld", {
                errandId,
                occurredAt: new Date().toISOString(),
            })
        })
    } catch (error) {
        // Let the consumer handle failures without acknowledging the event.
        throw error;
    }
}

export async function ensureCreditsReleased(errandId: number) {
    try {
        await db.transaction(async tx => {
            const outbox = new OutboxRepository(tx);

            const hold = await tx.orm.public.CreditsOnHold
                .where({ errandId: errandId })
                .forUpdate()
                .first()
            
            if (!hold) {
                await outbox.createEvent("credits.released.rejected", "creditsReleasedRejected", {
                    errandId,
                    reason: "ERRAND_NOT_FOUND",
                    occurredAt: new Date().toISOString(),
                });
                return;
            }
            
            const { courierId, amount, status } = hold 

            if (status === "RELEASED") {
                return;
            }

            if (status !== "HELD") {
                await outbox.createEvent("credits.released.rejected", "creditsReleasedRejected", {
                    errandId,
                    reason: "HOLD_ALREADY_REFUNDED",
                    occurredAt: new Date().toISOString(),
                });
                return;
            }

            const courier = await tx.orm.public.UserCredits
                .where({ userId: courierId })
                .forUpdate()
                .first()

            if (!courier) {
                await outbox.createEvent("credits.released.rejected", "creditsReleasedRejected", {
                    errandId,
                    reason: "COURIER_NOT_FOUND",
                    occurredAt: new Date().toISOString(),
                })
                return;
            }
            
            await tx.orm.public.UserCredits
                .where({ userId: courierId })
                .update({ balance: courier.balance + amount })

            await tx.orm.public.CreditsOnHold
                .where({ errandId: errandId })
                .update({ status: "RELEASED" })

            await outbox.createEvent("credits.released", "creditsReleased", {
                errandId,
                occurredAt: new Date().toISOString(),
            });
        })
    }
    catch (error) {
    // Let the consumer handle failures without acknowledging the event.
        throw error;
    }
}

export async function ensureCreditsRefunded(errandId: number) {
    try {
        await db.transaction(async tx => {
            const outbox = new OutboxRepository(tx);

            const hold = await tx.orm.public.CreditsOnHold
                .where({ errandId: errandId })
                .forUpdate()
                .first()
            
            if (!hold) {
                await outbox.createEvent("credits.refunded.rejected", "creditsRefundedRejected", {
                    errandId,
                    reason: "ERRAND_NOT_FOUND",
                    occurredAt: new Date().toISOString(),
                });
                return;
            }
            
            const { requestorId, amount, status } = hold 

            if (status === "REFUNDED") {
                return;
            }

            if (status !== "HELD") {
                await outbox.createEvent("credits.refunded.rejected", "creditsRefundedRejected", {
                    errandId,
                    reason: "HOLD_ALREADY_RELEASED",
                    occurredAt: new Date().toISOString(),
                });
                return;
            }

            const requestor = await tx.orm.public.UserCredits
                .where({ userId: requestorId })
                .forUpdate()
                .first()

            if (!requestor) {
                await outbox.createEvent("credits.refunded.rejected", "creditsRefundedRejected", {
                    errandId,
                    reason: "REQUESTOR_NOT_FOUND",
                    occurredAt: new Date().toISOString(),
                })
                return;
            }
            
            await tx.orm.public.UserCredits
                .where({ userId: requestorId })
                .update({ balance: requestor.balance + amount })

            await tx.orm.public.CreditsOnHold
                .where({ errandId: errandId })
                .update({ status: "REFUNDED" })

            await outbox.createEvent("credits.refunded", "creditsRefunded", {
                errandId,
                occurredAt: new Date().toISOString(),
            });
        })
    }
    catch (error) {
    // Let the consumer handle failures without acknowledging the event.
        throw error;
    }
}
