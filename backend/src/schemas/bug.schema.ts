import { z } from 'zod';
import { BUG_SEVERITIES, BUG_STATUSES } from '../models/bug.model.js';

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

// imageKey is deliberately absent: it is written only by the verified
// image-attachment endpoint, never by create or update payloads.
const bugFields = {
  title: z.string().trim().min(1, 'Title is required').max(200, 'Title must be at most 200 characters'),
  description: z
    .string()
    .trim()
    .min(1, 'Description is required')
    .max(5000, 'Description must be at most 5000 characters'),
  severity: z.enum(BUG_SEVERITIES),
  status: z.enum(BUG_STATUSES).optional(),
};

// Strict objects reject unknown keys, so a client cannot smuggle in a `userId`.
export const createBugSchema = z.strictObject(bugFields);

export const updateBugSchema = z
  .strictObject(bugFields)
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field must be provided' });

export const listBugsQuerySchema = z.object({
  status: z.enum(BUG_STATUSES).optional(),
});

export const bugIdSchema = z.string().regex(OBJECT_ID_PATTERN, 'Invalid bug id');

export type CreateBugInput = z.infer<typeof createBugSchema>;
export type UpdateBugInput = z.infer<typeof updateBugSchema>;
export type ListBugsQuery = z.infer<typeof listBugsQuerySchema>;
