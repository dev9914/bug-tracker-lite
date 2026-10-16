/**
 * Types mirroring the actual responses of the Bug Tracker Lite backend.
 * Keep these in sync with backend/src/controllers and backend/src/models.
 */

export const BUG_SEVERITIES = ['low', 'med', 'high'] as const
export type BugSeverity = (typeof BUG_SEVERITIES)[number]

export const BUG_STATUSES = ['open', 'in-progress', 'closed'] as const
export type BugStatus = (typeof BUG_STATUSES)[number]

/** Shape returned by `toBugResponse` in backend/src/controllers/bug.controller.ts */
export interface Bug {
  id: string
  userId: string
  title: string
  description: string
  severity: BugSeverity
  status: BugStatus
  imageKey: string | null
  createdAt: string
  updatedAt: string
}

/** `toPublicUser` in backend/src/controllers/auth.controller.ts */
export interface AuthUser {
  id: string
  name: string
  email: string
}

export interface AuthResponse {
  token: string
  user: AuthUser
}

export interface SignupInput {
  name: string
  email: string
  password: string
}

export interface LoginInput {
  email: string
  password: string
}

/** Matches `createBugSchema` (imageKey is never accepted here). */
export interface CreateBugInput {
  title: string
  description: string
  severity: BugSeverity
  status?: BugStatus
}

/** Matches `updateBugSchema` (all fields optional, at least one required). */
export type UpdateBugInput = Partial<CreateBugInput>

/** Response of `POST /api/uploads/presign`. */
export interface PresignUploadResponse {
  upload: {
    key: string
    url: string
    contentType: string
    maxSizeBytes: number
    expiresIn: number
  }
}

/** Response of `GET /api/bugs/:id/image-url`. */
export interface BugImageUrlResponse {
  image: {
    key: string
    url: string
    expiresIn: number
  }
}

/** One entry of `error.details` produced by `sendValidationError`. */
export interface ValidationDetail {
  field: string
  message: string
}
