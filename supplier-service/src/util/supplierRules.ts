import { z } from "zod";
import { SupplierType } from "../common.ts";

export interface OpeningHours {
    opensAt: string;
    closesAt: string;
}

// the fields a client may set, after defaults are applied
export interface SupplierFields {
    name: string;
    type: SupplierType;
    description: string | null;
    locationId: number | null;
    openingHours: OpeningHours | null;
}

export type FieldErrors = Partial<Record<keyof SupplierFields, string[]>>;

const hourMinute = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected a time in 24-hour HH:MM format");

export const openingHoursSchema = z.object({
    opensAt: hourMinute,
    closesAt: hourMinute,
}).strict().refine(h => h.opensAt !== h.closesAt, {
    message: "Opening and closing times must differ",
    path: ["closesAt"],
});

export const supplierFieldSchemas = {
    name: z.string().trim().min(1, "Name is required").max(100, "Name must be at most 100 characters"),
    type: z.enum(SupplierType, "Type must be one of store, facility or landmark"),
    // blank descriptions are stored as null
    description: z.string().trim().max(500, "Description must be at most 500 characters")
        .transform(s => s.length > 0 ? s : null).nullable(),
    locationId: z.number().int().positive("Location must be a supplier id").nullable(),
    openingHours: openingHoursSchema.nullable(),
};

/**
 * Rules that depend on more than one field. Used on create, and on update
 * against the merged result of the stored supplier and the patch.
 */
export function checkCrossFieldRules(s: SupplierFields): FieldErrors {
    const errors: FieldErrors = {};
    if (s.type === SupplierType.Landmark) {
        if (s.locationId !== null)
            errors.locationId = ["A landmark cannot be located at another landmark"];
        if (s.openingHours !== null)
            errors.openingHours = ["A landmark cannot have opening hours"];
    } else if (s.locationId === null) {
        errors.locationId = [`A ${s.type} must be located at a landmark`];
    }
    return errors;
}

export const hasErrors = (errors: FieldErrors) => Object.keys(errors).length > 0;
