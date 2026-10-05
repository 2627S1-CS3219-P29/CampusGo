import { z } from "zod";

export const createSupplierSchema = z.object({
    name: z.string().trim().min(1),
    type: z.array(
        z.enum(["food", "shopping", "printing", "coffee"]),
    ).min(1),
    locationId: z.number().int().positive(),
    floor: z.number().int().positive().optional(),
    imageUrl: z.url().nullable().optional(),
    description: z.string().nullable().optional(),
    opensAt: z.string()
            .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM")
            .nullable().optional(),
        closesAt: z.string()
            .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM")
            .nullable().optional(),
    }).strict().refine(
        body => (body.opensAt == null) === (body.closesAt == null),
        {
            message: "Provide both opensAt and closesAt, or neither",
            path: ["closesAt"],
    },
);

// allows optional searching by name, filtering by location,
// sorting by name, sort order, and pageNumber
// page limit set to 20 is handled in the controller
export const listSuppliersQuerySchema = z.object({
    name: z.string().trim().min(1).optional(),
    locationId: z.coerce.number().int().positive().optional(),

    sortBy: z.enum(["id", "name"]).default("id"),
    sortOrder: z.enum(["asc", "desc"]).default("asc"),

    page: z.coerce.number().int().positive().default(1),
}).strict();

export type ListSuppliersQuery =
    z.infer<typeof listSuppliersQuerySchema>;
