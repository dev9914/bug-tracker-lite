import { z } from 'zod';
import { IMAGE_CONTENT_TYPES, MAX_IMAGE_BYTES, MAX_IMAGE_MB } from '../utils/image.js';

export const presignUploadSchema = z.strictObject({
  contentType: z.enum(IMAGE_CONTENT_TYPES),
  // The client declares the size up front; the real size is verified against S3 later.
  size: z
    .number()
    .int('size must be a whole number of bytes')
    .positive('size must be greater than zero')
    .max(MAX_IMAGE_BYTES, `Image must be at most ${MAX_IMAGE_MB} MB`)
    .optional(),
});

export const attachImageSchema = z.strictObject({
  imageKey: z.string().trim().min(1, 'imageKey is required').max(512, 'imageKey must be at most 512 characters'),
});

export type PresignUploadInput = z.infer<typeof presignUploadSchema>;
export type AttachImageInput = z.infer<typeof attachImageSchema>;
