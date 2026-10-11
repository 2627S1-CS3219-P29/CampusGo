import type { Context, RouterContext } from "@oak/oak";
import config from "../config.ts";
import log from "../log.ts";
import { Role } from "../common.ts";
import type { AuthenticatedUser } from "../middleware/auth.ts";
import type { CreateOrderBody, ListOrdersQuery, UpdateOrderStatusBody } from "../schema/order.ts";
import { lookupPickup } from "../util/supplierService.ts";
import {
    createOrder as insertOrder,
    expireDueOrders,
    findOrderById,
    findOrderByIdempotencyKey,
    listOrders,
    transitionOrder,
    type Order,
} from "../prisma/orders.ts";

// TODO: replace these synchronous calls with the order/credit events (credit service not ready yet)
const CREDIT_SERVICE_URL = "http://localhost:8002/credits";

const respond = (ctx: Context, status: number, body: Context["response"]["body"]) => {
    ctx.response.status = status;
    ctx.response.body = body;
};

const internalError = (ctx: Context, action: string, e: unknown) => {
    log.error(`failed to ${action}: ${e} (origin: ${(<Error>e)?.stack})`);
    respond(ctx, 500, { error: `Failed to ${action}` });
};

/**
 * Calls the credit service. Returns an error message if it rejected the request,
 * or null to carry on. As before, if it cannot be reached at all the error is
 * only logged and the order carries on (fixed once credits move to events).
 */
const callCreditService = async (path: string, body: unknown, rejectedMessage: string): Promise<string | null> => {
    try {
        const res = await fetch(`${CREDIT_SERVICE_URL}/${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        return res.ok ? null : rejectedMessage;
    } catch (e) {
        log.error(`credit service ${path} failed: ${e}`);
        return null;
    }
};

/**
 * GET /orders: one page of orders for a scope, newest first
 *   ?scope=open (default)  errands a courier can accept: open, not expired, not your own
 *   ?scope=requested       errands you created
 *   ?scope=delivering      errands you are the courier on
 *   ?scope=all             every order, admins only
 *   &status=A,B            only these statuses, e.g. COMPLETED,CANCELLED,EXPIRED for past orders
 *   &page=N                20 per page
 */
export const fetchOrders = async (ctx: Context) => {
    // set by validateQuery(listOrdersQuerySchema) and authenticationMiddleware in routes
    const query = <ListOrdersQuery>ctx.state.validatedQuery;
    const user = <AuthenticatedUser>ctx.state.user;

    if (query.scope === "all" && !user.roles.includes(Role.Admin)) {
        respond(ctx, 403, { error: "Only admins can list every order" });
        return;
    }

    try {
        // so lists never show an expired errand as still open
        await expireDueOrders();

        const limit = config.order.pageSize;
        const { data, total } = await listOrders({
            scope: query.scope,
            userId: user.id,
            statuses: query.status,
            page: query.page,
            pageSize: limit,
        });

        // same response shape as the supplier list
        respond(ctx, 200, {
            data,
            pagination: {
                page: query.page,
                limit,
                total,
                totalPage: Math.ceil(total / limit),
            },
        });
    } catch (e) {
        internalError(ctx, "fetch orders", e);
    }
};

/**
 * GET /orders/:id: one order, e.g. for the errand details and progress screen.
 * The requester, the assigned courier and admins can always see it. Anyone else only
 * while it is open (CREATED), so couriers can look before accepting; otherwise 404,
 * so other people's ongoing and past errands (and their dropoff locations) stay private.
 */
export const fetchOrder = async (ctx: RouterContext<"/:id">) => {
    const user = <AuthenticatedUser>ctx.state.user;

    try {
        let order = await findOrderById(ctx.params.id);

        // lazy expiry, as in updateOrderStatus: an open order past its expiry time becomes EXPIRED
        if (order && order.status === "CREATED" && new Date() > new Date(order.expiresAt)) {
            order = await transitionOrder(order.id, { from: "CREATED", to: "EXPIRED" }) ?? await findOrderById(order.id);
        }

        const canSee = order !== null && (
            order.requesterId === user.id ||
            order.courierId === user.id ||
            user.roles.includes(Role.Admin) ||
            order.status === "CREATED"
        );
        if (!canSee) {
            respond(ctx, 404, { error: "Order not found" });
            return;
        }

        respond(ctx, 200, order);
    } catch (e) {
        internalError(ctx, "fetch order", e);
    }
};

/**
 * POST /orders: the signed-in user creates an errand.
 * Sending the same Idempotency-Key again returns the existing order instead of creating a duplicate.
 */
export const createOrder = async (ctx: Context) => {
    // set by validateBody(createOrderSchema) and authenticationMiddleware in routes
    const body = <CreateOrderBody>ctx.state.validatedBody;
    const user = <AuthenticatedUser>ctx.state.user;
    const idempotencyKey = ctx.request.headers.get("Idempotency-Key");

    try {
        // 1. idempotency check
        if (idempotencyKey) {
            const existing = await findOrderByIdempotencyKey(idempotencyKey);
            if (existing) {
                respond(ctx, 200, { order: existing, deduplicated: true });
                return;
            }
        }

        // 2. the pickup must be a live supplier; its name and building become the pickup location
        const pickup = await lookupPickup(body.supplierId, ctx.request.headers.get("authorization") ?? "");
        if (!pickup.found) {
            if (pickup.reason === "NOT_FOUND")
                respond(ctx, 400, { error: "invalid request body", fields: { supplierId: ["Supplier not found"] } });
            else
                respond(ctx, 503, { error: "Supplier service is unavailable, try again later" });
            return;
        }

        // 3. credit escrow hold
        const rejected = await callCreditService("reserve", {
            userId: user.id,
            amount: body.creditBounty,
            referenceId: idempotencyKey,
        }, "Insufficient credits or Credit Service rejected hold.");
        if (rejected) {
            respond(ctx, 402, { error: rejected });
            return;
        }

        // 4. persist; the requester is whoever is signed in, never taken from the body
        let order: Order;
        try {
            order = await insertOrder({
                idempotencyKey,
                requesterId: user.id,
                supplierId: body.supplierId,
                pickupLocation: pickup.pickupLocation,
                dropoffLocation: body.dropoffLocation,
                itemDescription: body.itemDescription,
                creditBounty: body.creditBounty,
                additionalDetails: body.additionalDetails || null,
                expiresAt: new Date(Date.now() + config.order.expiryMs),
            });
        } catch (e) {
            // two requests with the same Idempotency-Key at the same moment: the unique key
            // lets only one insert succeed, the other returns the order that was created
            const existing = idempotencyKey ? await findOrderByIdempotencyKey(idempotencyKey) : null;
            if (!existing)
                throw e;
            respond(ctx, 200, { order: existing, deduplicated: true });
            return;
        }

        respond(ctx, 201, order);
    } catch (e) {
        internalError(ctx, "create order", e);
    }
};

/**
 * PATCH /orders/:id/status: moves an order along its lifecycle
 *   CREATED -> ACCEPTED -> PICKED_UP -> COMPLETED, or -> CANCELLED (and CREATED -> EXPIRED)
 * Each change is a single conditional UPDATE (see transitionOrder), so two requests
 * racing on the same order cannot both succeed.
 */
export const updateOrderStatus = async (ctx: RouterContext<"/:id/status">) => {
    const { targetStatus } = <UpdateOrderStatusBody>ctx.state.validatedBody;
    // the caller and their roles come from the access token, never from the body
    const user = <AuthenticatedUser>ctx.state.user;
    const callerId = user.id;
    const isAdmin = user.roles.includes(Role.Admin);
    const orderId = ctx.params.id;

    // returned when the order changed between reading it and updating it
    const changedMeanwhile = () => respond(ctx, 409, { error: "Order was updated by someone else, refresh and try again" });

    try {
        // 1. fetch current order
        const order = await findOrderById(orderId);
        if (!order) {
            respond(ctx, 404, { error: "Order not found" });
            return;
        }

        // 2. expiry guard (lazy check)
        if (order.status === "CREATED" && new Date() > new Date(order.expiresAt)) {
            await transitionOrder(orderId, { from: "CREATED", to: "EXPIRED" });
            respond(ctx, 410, { error: "Order has expired" });
            return;
        }

        // 3. authorization & transition rules
        let updated: Order | null;
        switch (targetStatus) {
            case "ACCEPTED": {
                if (order.status !== "CREATED") {
                    respond(ctx, 409, { error: `Cannot accept order in status ${order.status}` });
                    return;
                }
                if (callerId === order.requesterId) {
                    respond(ctx, 403, { error: "Requester cannot accept their own errand" });
                    return;
                }

                // concurrency guard: only one courier's update can match status CREATED
                updated = await transitionOrder(orderId, {
                    from: "CREATED",
                    to: "ACCEPTED",
                    courierId: callerId,
                    requireUnexpired: true,
                });
                if (!updated) {
                    respond(ctx, 409, { error: "Order was already accepted by another courier" });
                    return;
                }
                break;
            }

            case "PICKED_UP": {
                if (order.status !== "ACCEPTED") {
                    respond(ctx, 400, { error: `Cannot mark picked up from status ${order.status}` });
                    return;
                }
                if (callerId !== order.courierId) {
                    respond(ctx, 403, { error: "Only the assigned courier can mark item as picked up" });
                    return;
                }

                updated = await transitionOrder(orderId, { from: "ACCEPTED", to: "PICKED_UP" });
                if (!updated) {
                    changedMeanwhile();
                    return;
                }
                break;
            }

            case "COMPLETED": {
                if (order.status !== "PICKED_UP") {
                    respond(ctx, 400, { error: "Cannot complete order before it is picked up" });
                    return;
                }
                if (callerId !== order.requesterId) {
                    respond(ctx, 403, { error: "Only the requester can confirm completion" });
                    return;
                }

                // credit transfer to the courier
                const rejected = await callCreditService("transfer", {
                    courierId: order.courierId,
                    amount: order.creditBounty,
                    orderId: order.id,
                }, "Credit Service rejected payout transfer");
                if (rejected) {
                    respond(ctx, 502, { error: rejected });
                    return;
                }

                updated = await transitionOrder(orderId, { from: "PICKED_UP", to: "COMPLETED" });
                if (!updated) {
                    changedMeanwhile();
                    return;
                }
                break;
            }

            case "CANCELLED": {
                const canCancel = callerId === order.requesterId || isAdmin;
                if (!canCancel) {
                    respond(ctx, 403, { error: "Unauthorized to cancel this errand" });
                    return;
                }
                if (order.status === "COMPLETED" || order.status === "CANCELLED" || order.status === "EXPIRED") {
                    respond(ctx, 400, { error: `Cannot cancel an order in ${order.status} state` });
                    return;
                }

                // credit release back to the requester
                const rejected = await callCreditService("release", {
                    userId: order.requesterId,
                    amount: order.creditBounty,
                    orderId: order.id,
                }, "Credit Service rejected refund release");
                if (rejected) {
                    respond(ctx, 502, { error: rejected });
                    return;
                }

                updated = await transitionOrder(orderId, { from: order.status, to: "CANCELLED" });
                if (!updated) {
                    changedMeanwhile();
                    return;
                }
                break;
            }
        }

        respond(ctx, 200, updated);
    } catch (e) {
        internalError(ctx, "update order status", e);
    }
};
