import { randomUUID } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';

export const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number];

export const MAX_IMAGE_MB = 5;
export const MAX_IMAGE_BYTES = MAX_IMAGE_MB * 1024 * 1024;

/** Enough bytes for the magic-number sniff to recognise JPEG, PNG and WebP. */
export const IMAGE_SNIFF_BYTES = 4100;

const CONTENT_TYPE_EXTENSIONS: Record<ImageContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export function isAllowedImageType(value: string): value is ImageContentType {
  return (IMAGE_CONTENT_TYPES as readonly string[]).includes(value);
}

/**
 * Sniffs the real content type from the file's magic bytes, so a client cannot
 * pass off arbitrary bytes as an image by declaring an image Content-Type.
 * Returns null when the bytes do not match any known file signature.
 */
export async function sniffImageContentType(buffer: Buffer): Promise<string | null> {
  const detected = await fileTypeFromBuffer(buffer);

  return detected?.mime ?? null;
}

/** Builds an unpredictable, user-scoped key: `uploads/<userId>/<uuid>.<ext>`. */
export function buildImageKey(userId: string, contentType: ImageContentType): string {
  return `uploads/${userId}/${randomUUID()}.${CONTENT_TYPE_EXTENSIONS[contentType]}`;
}

/**
 * Only keys this server generated for the given user are accepted, so a client
 * can never point us at an arbitrary object in the bucket.
 */
export function isOwnedImageKey(userId: string, key: string): boolean {
  return new RegExp(`^uploads/${userId}/${UUID_PATTERN}\\.(jpg|png|webp)$`).test(key);
}
