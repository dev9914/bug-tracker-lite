import { Outlet } from 'react-router-dom'

/** Centered card shell for the sign-in and sign-up pages. */
export function AuthLayout() {
  return (
    <div className="auth-shell">
      <div className="auth-shell__inner">
        <div className="auth-brand">
          <span className="brand__mark" aria-hidden="true">
            BT
          </span>
          <span className="brand__text">Bug Tracker Lite</span>
        </div>

        <div className="auth-card">
          <Outlet />
        </div>

        <p className="auth-shell__footer">Track, triage and resolve bugs with image evidence.</p>
      </div>
    </div>
  )
}
