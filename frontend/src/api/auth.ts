import { apiRequest } from './client'
import type { AuthResponse, LoginInput, SignupInput } from './types'

/** `POST /api/auth/signup` -> 201 `{ token, user }` */
export function signup(input: SignupInput): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/api/auth/signup', { method: 'POST', body: input, auth: false })
}

/** `POST /api/auth/login` -> 200 `{ token, user }` */
export function login(input: LoginInput): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/api/auth/login', { method: 'POST', body: input, auth: false })
}
