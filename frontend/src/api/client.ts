import { clearSession, getToken, notifyUnauthorized } from '../auth/session'
import type { ValidationDetail } from './types'

/**
 * Base URL of the API. It must come from `VITE_API_URL` so the same build can
 * point at localhost or a deployed backend. Vite only inlines VITE_* variables.
 */
const configuredBaseUrl = import.meta.env.VITE_API_URL?.trim()

/** Local backend used by `npm run dev` when `VITE_API_URL` is not set. */
const LOCAL_DEVELOPMENT_URL = 'http://localhost:5000'

// Production builds must supply VITE_API_URL; only development may fall back to
// the local backend, so `npm run dev` keeps working without extra setup.
const resolvedBaseUrl = configuredBaseUrl || (import.meta.env.DEV ? LOCAL_DEVELOPMENT_URL : undefined)

if (!resolvedBaseUrl) {
  throw new Error(
    'VITE_API_URL is not set. Set it before building for production, e.g. VITE_API_URL=https://your-backend.example.com npm run build.',
  )
}

export const API_BASE_URL = resolvedBaseUrl.replace(/\/+$/, '')

/** Error thrown for every non-2xx API response, carrying the backend error shape. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: ValidationDetail[]

  constructor(status: number, code: string, message: string, details: ValidationDetail[] = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

interface ErrorBody {
  error?: {
    code?: unknown
    message?: unknown
    details?: unknown
  }
}

function toValidationDetails(value: unknown): ValidationDetail[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) {
      return []
    }

    const { field, message } = item as { field?: unknown; message?: unknown }

    return typeof field === 'string' && typeof message === 'string' ? [{ field, message }] : []
  })
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  /** Set to false for unauthenticated calls such as login and signup. */
  auth?: boolean
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options

  const headers: Record<string, string> = { Accept: 'application/json' }

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  if (auth) {
    const token = getToken()

    if (token) {
      headers.Authorization = `Bearer ${token}`
    }
  }

  let response: Response

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.')
  }

  // Only an authenticated request returning 401 means the session is gone; a 401
  // from login is just bad credentials and must not wipe an unrelated session.
  if (response.status === 401 && auth) {
    clearSession()
    notifyUnauthorized()
  }

  const payload = await parseJson(response)

  if (!response.ok) {
    const errorBody = (payload as ErrorBody | null)?.error
    const code = typeof errorBody?.code === 'string' ? errorBody.code : 'REQUEST_FAILED'
    const message =
      typeof errorBody?.message === 'string' && errorBody.message.length > 0
        ? errorBody.message
        : `Request failed with status ${response.status}`

    throw new ApiError(response.status, code, message, toValidationDetails(errorBody?.details))
  }

  return payload as T
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text()

  if (!text) {
    return null
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** Human readable message for anything thrown by the API layer. */
export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Something went wrong. Please try again.'
}

/** Field name -> message map taken from a validation error, for inline form errors. */
export function getFieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) {
    return {}
  }

  const errors: Record<string, string> = {}

  for (const detail of error.details) {
    if (detail.field && !errors[detail.field]) {
      errors[detail.field] = detail.message
    }
  }

  return errors
}
