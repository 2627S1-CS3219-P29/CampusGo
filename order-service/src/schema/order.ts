import { z } from "zod";
import config from "../config.ts";

// body of POST /orders; the requester is taken from the access token, not the body
export const createOrderSchema = z.object({
    // the pickup is always a registered supplier; its name and building become the pickup location
    supplierId: z.number({ error: "Supplier is required" }).int().positive(),
    dropoffLocation: z.string().trim().min(1, "Dropoff location is required").max(200),
    itemDescription: z.string().trim().min(1, "Item description is required").max(500),
    creditBounty: z.number().int("Must be a whole number").positive("Must be at least 1"),
    // anything more specific, e.g. a room number at the supplier's building
    additionalDetails: z.string().trim().max(500).nullable().optional(),
    // how long to wait for a courier; left out = the default (24h)
    expiresInMinutes: z.number().int("Must be a whole number of minutes")
        .min(config.order.expiry.minMinutes, `Must be at least ${config.order.expiry.minMinutes} minutes`)
        .max(config.order.expiry.maxMinutes, `Must be at most ${config.order.expiry.maxMinutes / 60} hours`)
        .optional(),
}).strict();

export type CreateOrderBody = z.infer<typeof createOrderSchema>;

const orderStatuses = ["CREATED", "ACCEPTED", "PICKED_UP", "COMPLETED", "CANCELLED", "EXPIRED"] as const;

// query of GET /orders; query strings are always text, so coerce them here
export const listOrdersQuerySchema = z.object({
    // open: errands couriers can accept (not your own); requested: yours; delivering: you are the courier;
    // all: every order (admins only)
    scope: z.enum(["open", "requested", "delivering", "all"]).default("open"),
    // comma separated, e.g. status=COMPLETED,CANCELLED,EXPIRED for past orders
    status: z.string()
        .transform(s => s.split(",").map(t => t.trim()).filter(t => t.length > 0))
        .pipe(z.array(z.enum(orderStatuses)))
        .optional(),
    page: z.coerce.number().int().positive().default(1),
}).strict();

export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

// body of PATCH /orders/:id/status; CREATED and EXPIRED are only ever set by the service
export const updateOrderStatusSchema = z.object({
    targetStatus: z.enum(["ACCEPTED", "PICKED_UP", "COMPLETED", "CANCELLED"]),
}).strict();

export type UpdateOrderStatusBody = z.infer<typeof updateOrderStatusSchema>;
