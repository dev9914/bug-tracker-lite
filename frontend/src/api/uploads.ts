import { attachBugImage } from './bugs'
import { apiRequest } from './client'
import type { Bug, PresignUploadResponse } from './types'

/** Mirrors backend/src/utils/image.ts so the browser can reject files early. */
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number]
export const MAX_IMAGE_MB = 5
export const MAX_IMAGE_BYTES = MAX_IMAGE_MB * 1024 * 1024

export function isAllowedImageType(value: string): value is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(value)
}

/** Accept attribute for the file input, kept in sync with the allowed types. */
export const IMAGE_ACCEPT_ATTRIBUTE = ALLOWED_IMAGE_TYPES.join(',')

export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageValidationError'
  }
}

/** Client-side checks; the backend re-validates the real bytes afterwards. */
export function validateImageFile(file: File): void {
  if (!isAllowedImageType(file.type)) {
    throw new ImageValidationError('Only JPG, PNG and WebP images are allowed.')
  }

  if (file.size > MAX_IMAGE_BYTES) {
    throw new ImageValidationError(`Image must be at most ${MAX_IMAGE_MB} MB.`)
  }
}

/**
 * 1. Ask the backend for a presigned PUT URL (`POST /api/uploads/presign`).
 * 2. PUT the raw file straight to S3 so the bytes never pass through Express.
 * Returns the server-generated object key to attach to the bug.
 */
export async function uploadImageToS3(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<string> {
  validateImageFile(file)

  const { upload } = await apiRequest<PresignUploadResponse>('/api/uploads/presign', {
    method: 'POST',
    body: { contentType: file.type, size: file.size },
  })

  await putFileToPresignedUrl(upload.url, file, upload.contentType, onProgress)

  return upload.key
}

/** Raw browser -> S3 upload. XHR is used only because fetch cannot report progress. */
function putFileToPresignedUrl(
  url: string,
  file: File,
  contentType: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()

    request.open('PUT', url)
    // Must match the Content-Type that was signed, and must not add an
    // Authorization header: the presigned URL carries its own credentials.
    request.setRequestHeader('Content-Type', contentType)

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve()
        return
      }

      reject(new ImageValidationError(`Uploading to storage failed (status ${request.status}).`))
    }

    request.onerror = () => {
      reject(new ImageValidationError('Uploading to storage failed due to a network error.'))
    }

    request.send(file)
  })
}

/**
 * Complete backend flow: presign, upload directly to S3, then attach the key to
 * the bug. The returned bug is the refreshed record with `imageKey` set.
 */
export async function uploadBugImage(
  bugId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<Bug> {
  const imageKey = await uploadImageToS3(file, onProgress)

  return attachBugImage(bugId, imageKey)
}
