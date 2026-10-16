import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { getErrorMessage, getFieldErrors } from '../api/client'
import { useAuth } from '../auth/useAuth'
import { Alert } from '../components/Alert'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const NAME_MIN = 2
const NAME_MAX = 80
const PASSWORD_MIN = 8
const PASSWORD_MAX = 72

interface FieldErrors {
  name?: string
  email?: string
  password?: string
}

export function RegisterPage() {
  const { isAuthenticated, register } = useAuth()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />
  }

  function validate(): boolean {
    const errors: FieldErrors = {}
    const trimmedName = name.trim()

    if (trimmedName.length < NAME_MIN) {
      errors.name = `Name must be at least ${NAME_MIN} characters.`
    } else if (trimmedName.length > NAME_MAX) {
      errors.name = `Name must be at most ${NAME_MAX} characters.`
    }

    if (!email.trim()) {
      errors.email = 'Email is required.'
    } else if (!EMAIL_PATTERN.test(email.trim())) {
      errors.email = 'Enter a valid email address.'
    }

    if (password.length < PASSWORD_MIN) {
      errors.password = `Password must be at least ${PASSWORD_MIN} characters.`
    } else if (password.length > PASSWORD_MAX) {
      errors.password = `Password must be at most ${PASSWORD_MAX} characters.`
    }

    setFieldErrors(errors)

    return Object.keys(errors).length === 0
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (!validate()) {
      return
    }

    setSubmitting(true)

    try {
      // The backend issues a token on signup, so this also signs the user in.
      await register(name.trim(), email.trim(), password)
      navigate('/dashboard', { replace: true })
    } catch (submitError) {
      // Surface per-field messages from the backend's validation error, if any.
      setFieldErrors(getFieldErrors(submitError))
      setError(getErrorMessage(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h1 className="auth-card__title">Create your account</h1>
      <p className="auth-card__subtitle">Start tracking bugs in a minute.</p>

      {error ? <Alert variant="error">{error}</Alert> : null}

      <form className="form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label className="field__label" htmlFor="register-name">
            Full name
          </label>
          <input
            id="register-name"
            className="input"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={Boolean(fieldErrors.name)}
            disabled={submitting}
          />
          {fieldErrors.name ? <p className="field__error">{fieldErrors.name}</p> : null}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="register-email">
            Email
          </label>
          <input
            id="register-email"
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={Boolean(fieldErrors.email)}
            disabled={submitting}
          />
          {fieldErrors.email ? <p className="field__error">{fieldErrors.email}</p> : null}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="register-password">
            Password
          </label>
          <input
            id="register-password"
            className="input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(fieldErrors.password)}
            disabled={submitting}
          />
          {fieldErrors.password ? (
            <p className="field__error">{fieldErrors.password}</p>
          ) : (
            <p className="field__hint">At least {PASSWORD_MIN} characters.</p>
          )}
        </div>

        <button type="submit" className="btn btn--primary btn--block" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="auth-card__footer">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </div>
  )
}
