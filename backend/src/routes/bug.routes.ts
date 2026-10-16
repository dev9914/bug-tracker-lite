import { Router } from 'express';
import {
  attachImage,
  createBug,
  deleteBug,
  getBug,
  getBugImageUrl,
  listBugs,
  updateBug,
} from '../controllers/bug.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

export const bugRouter = Router();

// Every bug route requires a valid Bearer token.
bugRouter.use(requireAuth);

bugRouter.post('/', createBug);
bugRouter.get('/', listBugs);
bugRouter.get('/:id', getBug);
bugRouter.put('/:id', updateBug);
bugRouter.delete('/:id', deleteBug);

// Image endpoints: attach an already-uploaded object, then read it back.
bugRouter.post('/:id/image', attachImage);
bugRouter.get('/:id/image-url', getBugImageUrl);
