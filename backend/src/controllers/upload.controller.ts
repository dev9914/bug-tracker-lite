import type { NextFunction, Request, Response } from 'express';
import { PRESIGNED_URL_EXPIRES_IN_SECONDS } from '../config/s3.js';
import { presignUploadSchema } from '../schemas/upload.schema.js';
import { createPresignedPutUrl } from '../services/s3.service.js';
import { sendError, sendValidationError } from '../utils/http.js';
import { MAX_IMAGE_BYTES, buildImageKey } from '../utils/image.js';

export async function presignUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = presignUploadSchema.safeParse(req.body);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { contentType } = parsed.data;
    // The key is always server-generated and scoped to the authenticated user.
    const key = buildImageKey(req.userId, contentType);

    let uploadUrl: string;
    try {
      uploadUrl = await createPresignedPutUrl(key, contentType);
    } catch (error) {
      console.error(error);
      sendError(res, 502, 'S3_ERROR', 'Could not create an upload URL right now');
      return;
    }

    res.status(200).json({
      upload: {
        key,
        url: uploadUrl,
        contentType,
        maxSizeBytes: MAX_IMAGE_BYTES,
        expiresIn: PRESIGNED_URL_EXPIRES_IN_SECONDS,
      },
    });
  } catch (error) {
    next(error);
  }
}
