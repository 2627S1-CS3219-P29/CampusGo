import { z } from "zod";

export const createLocationSchema = z.object({
    name: z.string().trim().min(1, "Name is required").max(100),
}).strict();

export type CreateLocationBody = z.infer<typeof createLocationSchema>;
