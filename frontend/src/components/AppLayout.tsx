import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'nav-link nav-link--active' : 'nav-link'
}

export function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__inner">
          <Link to="/dashboard" className="brand">
            <span className="brand__mark" aria-hidden="true">
              BT
            </span>
            <span className="brand__text">Bug Tracker Lite</span>
          </Link>

          <nav className="app-nav" aria-label="Main">
            <NavLink to="/dashboard" className={navLinkClass}>
              Dashboard
            </NavLink>
            <NavLink to="/bugs/new" className={navLinkClass}>
              New Bug
            </NavLink>
          </nav>

          <div className="app-header__user">
            {user ? (
              <span className="app-header__name" title={user.email}>
                {user.name}
              </span>
            ) : null}
            <button type="button" className="btn btn--ghost btn--sm" onClick={handleLogout}>
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="app-main">
        <div className="container">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
