import { Router } from 'express';
import { presignUpload } from '../controllers/upload.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

export const uploadRouter = Router();

// Generating an upload URL requires a valid Bearer token.
uploadRouter.use(requireAuth);

uploadRouter.post('/presign', presignUpload);
