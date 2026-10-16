import { apiRequest } from './client'
import type { Bug, BugImageUrlResponse, BugStatus, CreateBugInput, UpdateBugInput } from './types'

/** `GET /api/bugs?status=` -> 200 `{ bugs }`, newest first. */
export async function listBugs(status?: BugStatus): Promise<Bug[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : ''
  const data = await apiRequest<{ bugs: Bug[] }>(`/api/bugs${query}`)

  return data.bugs
}

/** `GET /api/bugs/:id` -> 200 `{ bug }` */
export async function getBug(id: string): Promise<Bug> {
  const data = await apiRequest<{ bug: Bug }>(`/api/bugs/${encodeURIComponent(id)}`)

  return data.bug
}

/** `POST /api/bugs` -> 201 `{ bug }` */
export async function createBug(input: CreateBugInput): Promise<Bug> {
  const data = await apiRequest<{ bug: Bug }>('/api/bugs', { method: 'POST', body: input })

  return data.bug
}

/** `PUT /api/bugs/:id` -> 200 `{ bug }` */
export async function updateBug(id: string, input: UpdateBugInput): Promise<Bug> {
  const data = await apiRequest<{ bug: Bug }>(`/api/bugs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: input,
  })

  return data.bug
}

/** `DELETE /api/bugs/:id` -> 200 `{ success, id }` */
export async function deleteBug(id: string): Promise<void> {
  await apiRequest<{ success: boolean; id: string }>(`/api/bugs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

/**
 * `GET /api/bugs/:id/image-url` -> 200 `{ image: { key, url, expiresIn } }`.
 * The presigned URL is short-lived (300s) and must be re-fetched, never cached.
 */
export async function getBugImageUrl(id: string): Promise<BugImageUrlResponse['image']> {
  const data = await apiRequest<BugImageUrlResponse>(`/api/bugs/${encodeURIComponent(id)}/image-url`)

  return data.image
}

/** `POST /api/bugs/:id/image` -> 200 `{ bug }`; links an already uploaded object. */
export async function attachBugImage(id: string, imageKey: string): Promise<Bug> {
  const data = await apiRequest<{ bug: Bug }>(`/api/bugs/${encodeURIComponent(id)}/image`, {
    method: 'POST',
    body: { imageKey },
  })

  return data.bug
}
