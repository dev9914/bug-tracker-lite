import type { AuthUser } from '../api/types'

/**
 * The backend authenticates with a `Authorization: Bearer <token>` header (no
 * cookies), so the simplest storage that works with that API is localStorage.
 * Note: localStorage is readable by any script on this origin, so this relies on
 * the app not having an XSS hole; a same-site httpOnly cookie would need backend
 * changes that are out of scope here.
 */
const TOKEN_KEY = 'bug-tracker-lite.token'
const USER_KEY = 'bug-tracker-lite.user'

/** Fired when the API answers 401 so the provider can drop the session. */
const UNAUTHORIZED_EVENT = 'bug-tracker-lite:unauthorized'

export function getToken(): string | null {
  return window.localStorage.getItem(TOKEN_KEY)
}

export function getStoredUser(): AuthUser | null {
  const raw = window.localStorage.getItem(USER_KEY)

  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}

export function saveSession(token: string, user: AuthUser): void {
  window.localStorage.setItem(TOKEN_KEY, token)
  window.localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearSession(): void {
  window.localStorage.removeItem(TOKEN_KEY)
  window.localStorage.removeItem(USER_KEY)
}

export function notifyUnauthorized(): void {
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
}

/** Subscribes to 401 events; returns an unsubscribe function. */
export function onUnauthorized(handler: () => void): () => void {
  window.addEventListener(UNAUTHORIZED_EVENT, handler)

  return () => {
    window.removeEventListener(UNAUTHORIZED_EVENT, handler)
  }
}
