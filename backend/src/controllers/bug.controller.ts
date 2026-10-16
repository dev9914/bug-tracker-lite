import type { NextFunction, Request, Response } from 'express';
import { PRESIGNED_URL_EXPIRES_IN_SECONDS } from '../config/s3.js';
import { BugModel, type BugDocument } from '../models/bug.model.js';
import {
  bugIdSchema,
  createBugSchema,
  listBugsQuerySchema,
  updateBugSchema,
} from '../schemas/bug.schema.js';
import { attachImageSchema } from '../schemas/upload.schema.js';
import {
  createPresignedGetUrl,
  deleteObject,
  headObject,
  readObjectPrefix,
  type S3ObjectSummary,
} from '../services/s3.service.js';
import { sendError, sendValidationError } from '../utils/http.js';
import {
  IMAGE_SNIFF_BYTES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_MB,
  isAllowedImageType,
  isOwnedImageKey,
  sniffImageContentType,
} from '../utils/image.js';

function toBugResponse(bug: BugDocument) {
  return {
    id: bug.id,
    userId: bug.userId,
    title: bug.title,
    description: bug.description,
    severity: bug.severity,
    status: bug.status,
    imageKey: bug.imageKey ?? null,
    createdAt: bug.createdAt,
    updatedAt: bug.updatedAt,
  };
}

/** Returns the id when it is a valid ObjectId string, otherwise null. */
function parseBugId(value: string): string | null {
  const parsed = bugIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Best-effort removal of an upload that failed verification. Only ever called
 * with a key that already passed `isOwnedImageKey`, so it cannot touch another
 * user's object; a failed cleanup is logged and never masks the real error.
 */
async function discardRejectedUpload(key: string): Promise<void> {
  try {
    await deleteObject(key);
  } catch (error) {
    console.error('Failed to clean up a rejected upload', error);
  }
}

export async function createBug(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = createBugSchema.safeParse(req.body);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    // Ownership always comes from the verified JWT, never from the request body.
    const bug = await BugModel.create({ ...parsed.data, userId: req.userId });

    res.status(201).json({ bug: toBugResponse(bug) });
  } catch (error) {
    next(error);
  }
}

export async function listBugs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = listBugsQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    // Every query is scoped to the owner; the optional status narrows it further.
    const bugs = await BugModel.find({
      userId: req.userId,
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
    }).sort({ createdAt: -1 });

    res.status(200).json({ bugs: bugs.map(toBugResponse) });
  } catch (error) {
    next(error);
  }
}

export async function getBug(req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = parseBugId(req.params.id);

    if (!id) {
      sendError(res, 400, 'INVALID_ID', 'Invalid bug id');
      return;
    }

    // Scoped to the owner so another user's bug is indistinguishable from a missing one.
    const bug = await BugModel.findOne({ _id: id, userId: req.userId });

    if (!bug) {
      sendError(res, 404, 'NOT_FOUND', 'Bug not found');
      return;
    }

    res.status(200).json({ bug: toBugResponse(bug) });
  } catch (error) {
    next(error);
  }
}

export async function updateBug(req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = parseBugId(req.params.id);

    if (!id) {
      sendError(res, 400, 'INVALID_ID', 'Invalid bug id');
      return;
    }

    const parsed = updateBugSchema.safeParse(req.body);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    // Only validated fields reach the update, which prevents mass assignment.
    const bug = await BugModel.findOneAndUpdate(
      { _id: id, userId: req.userId },
      parsed.data,
      { new: true, runValidators: true },
    );

    if (!bug) {
      sendError(res, 404, 'NOT_FOUND', 'Bug not found');
      return;
    }

    res.status(200).json({ bug: toBugResponse(bug) });
  } catch (error) {
    next(error);
  }
}

export async function attachImage(req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = parseBugId(req.params.id);

    if (!id) {
      sendError(res, 400, 'INVALID_ID', 'Invalid bug id');
      return;
    }

    const parsed = attachImageSchema.safeParse(req.body);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { imageKey } = parsed.data;

    // Only keys this server generated for the caller may be attached.
    if (!isOwnedImageKey(req.userId, imageKey)) {
      sendError(res, 400, 'INVALID_IMAGE_KEY', 'imageKey must be an upload created by this account');
      return;
    }

    const bug = await BugModel.findOne({ _id: id, userId: req.userId });

    if (!bug) {
      sendError(res, 404, 'NOT_FOUND', 'Bug not found');
      return;
    }

    // A presigned PUT URL does not enforce a size limit, so verify what actually
    // landed in S3 before linking it to the bug.
    let object: S3ObjectSummary | null;
    try {
      object = await headObject(imageKey);
    } catch (error) {
      console.error(error);
      sendError(res, 502, 'S3_ERROR', 'Could not verify the uploaded image');
      return;
    }

    if (!object) {
      sendError(res, 400, 'IMAGE_NOT_UPLOADED', 'No uploaded image was found for this key');
      return;
    }

    if (object.contentLength > MAX_IMAGE_BYTES) {
      // The rejected upload belongs to the caller, so it is safe to remove it.
      await discardRejectedUpload(imageKey);
      sendError(res, 400, 'IMAGE_TOO_LARGE', `Image must be at most ${MAX_IMAGE_MB} MB`);
      return;
    }

    if (!object.contentType || !isAllowedImageType(object.contentType)) {
      await discardRejectedUpload(imageKey);
      sendError(res, 400, 'UNSUPPORTED_IMAGE_TYPE', 'Only JPG, PNG and WebP images are allowed');
      return;
    }

    // HeadObject metadata only reflects the client-declared Content-Type, which
    // can be spoofed, so sniff the stored bytes before trusting the object.
    let detectedType: string | null;
    try {
      const prefix = await readObjectPrefix(imageKey, IMAGE_SNIFF_BYTES);
      detectedType = await sniffImageContentType(prefix);
    } catch (error) {
      console.error(error);
      sendError(res, 502, 'S3_ERROR', 'Could not verify the uploaded image');
      return;
    }

    if (!detectedType || !isAllowedImageType(detectedType)) {
      await discardRejectedUpload(imageKey);
      sendError(res, 400, 'INVALID_IMAGE_CONTENT', 'The uploaded file is not a valid JPG, PNG or WebP image');
      return;
    }

    if (detectedType !== object.contentType) {
      await discardRejectedUpload(imageKey);
      sendError(res, 400, 'IMAGE_CONTENT_TYPE_MISMATCH', 'The uploaded file does not match its declared image type');
      return;
    }

    bug.imageKey = imageKey;
    await bug.save();

    res.status(200).json({ bug: toBugResponse(bug) });
  } catch (error) {
    next(error);
  }
}

export async function getBugImageUrl(req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = parseBugId(req.params.id);

    if (!id) {
      sendError(res, 400, 'INVALID_ID', 'Invalid bug id');
      return;
    }

    const bug = await BugModel.findOne({ _id: id, userId: req.userId });

    if (!bug) {
      sendError(res, 404, 'NOT_FOUND', 'Bug not found');
      return;
    }

    if (!bug.imageKey) {
      sendError(res, 404, 'IMAGE_NOT_FOUND', 'This bug has no image');
      return;
    }

    // Defence in depth: never sign a URL for an object that does not belong to
    // the caller, even if a key from another account somehow ended up stored.
    if (!isOwnedImageKey(req.userId, bug.imageKey)) {
      sendError(res, 404, 'IMAGE_NOT_FOUND', 'This bug has no image');
      return;
    }

    let url: string;
    try {
      url = await createPresignedGetUrl(bug.imageKey);
    } catch (error) {
      console.error(error);
      sendError(res, 502, 'S3_ERROR', 'Could not create an image URL right now');
      return;
    }

    res.status(200).json({
      image: { key: bug.imageKey, url, expiresIn: PRESIGNED_URL_EXPIRES_IN_SECONDS },
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteBug(req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = parseBugId(req.params.id);

    if (!id) {
      sendError(res, 400, 'INVALID_ID', 'Invalid bug id');
      return;
    }

    const bug = await BugModel.findOne({ _id: id, userId: req.userId });

    if (!bug) {
      sendError(res, 404, 'NOT_FOUND', 'Bug not found');
      return;
    }

    // Remove the stored image first: if S3 cleanup fails the bug is left untouched
    // so we never report a successful deletion while its object still exists.
    if (bug.imageKey) {
      // Defence in depth: only ever delete an object owned by the caller.
      if (isOwnedImageKey(req.userId, bug.imageKey)) {
        try {
          await deleteObject(bug.imageKey);
        } catch (error) {
          console.error(error);
          sendError(res, 502, 'S3_ERROR', 'Could not delete the bug image, so the bug was not deleted');
          return;
        }
      } else {
        console.error('Skipped deleting an image key that is not owned by the requesting user');
      }
    }

    await BugModel.deleteOne({ _id: id, userId: req.userId });

    res.status(200).json({ success: true, id: bug.id });
  } catch (error) {
    next(error);
  }
}
