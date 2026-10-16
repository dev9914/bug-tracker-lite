import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import * as authApi from '../api/auth'
import type { AuthUser } from '../api/types'
import { AuthContext, type AuthContextValue } from './AuthContext'
import { clearSession, getStoredUser, onUnauthorized, saveSession } from './session'

export function AuthProvider({ children }: { children: ReactNode }) {
  // Seeded from storage so a refresh keeps the user signed in without a round trip.
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser())

  useEffect(() => {
    // The API client raises this when an authenticated request returns 401.
    return onUnauthorized(() => setUser(null))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const { token, user: authenticated } = await authApi.login({ email, password })
    saveSession(token, authenticated)
    setUser(authenticated)
  }, [])

  const register = useCallback(async (name: string, email: string, password: string) => {
    // The backend signs the user in on signup, so the token can be stored straight away.
    const { token, user: created } = await authApi.signup({ name, email, password })
    saveSession(token, created)
    setUser(created)
  }, [])

  const logout = useCallback(() => {
    clearSession()
    setUser(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, isAuthenticated: user !== null, login, register, logout }),
    [user, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
