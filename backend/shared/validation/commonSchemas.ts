import { z } from 'zod';

/**
 * Reusable validation schemas built with Zod.
 */

// UUID v4 format validation
export const uuidSchema = z.string().uuid({ message: "Invalid UUID format" });

// Numeric currency validation string
export const moneyStringSchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, { message: "Currency must be a valid decimal string with up to 2 decimal places" });

// Pagination Query validation
export const paginationParamsSchema = z.object({
  page: z.preprocess((val) => Number(val), z.number().int().positive()).default(1),
  limit: z.preprocess((val) => Number(val), z.number().int().positive().max(100)).default(20),
});
