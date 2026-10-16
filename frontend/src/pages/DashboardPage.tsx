import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { listBugs } from '../api/bugs'
import { getErrorMessage } from '../api/client'
import type { Bug } from '../api/types'
import { useAuth } from '../auth/useAuth'
import { Alert } from '../components/Alert'
import { SeverityBadge, StatusBadge } from '../components/Badge'
import { Spinner } from '../components/Spinner'
import { STATUS_FILTERS, formatDateTime, type StatusFilter } from '../lib/display'

interface LocationState {
  flash?: string
}

export function DashboardPage() {
  const { user } = useAuth()
  const location = useLocation()

  // Set when another page redirects here after a successful action (e.g. delete).
  const [flash] = useState<string | null>(
    () => (location.state as LocationState | null)?.flash ?? null,
  )

  const [bugs, setBugs] = useState<Bug[]>([])
  const [status, setStatus] = useState<StatusFilter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function loadBugs() {
      setLoading(true)
      setError(null)

      try {
        const result = await listBugs(status === 'all' ? undefined : status)

        if (!cancelled) {
          setBugs(result)
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(getErrorMessage(requestError))
          setBugs([])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadBugs()

    return () => {
      cancelled = true
    }
  }, [status, reloadToken])

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Bug dashboard</h1>
          <p className="page__subtitle">
            {user ? `Signed in as ${user.name}` : 'Your reported issues'}
          </p>
        </div>
        <Link to="/bugs/new" className="btn btn--primary">
          Create bug
        </Link>
      </div>

      {flash ? <Alert variant="success">{flash}</Alert> : null}

      <div className="filters" role="group" aria-label="Filter bugs by status">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            className={`filter-tab${status === filter.value ? ' filter-tab--active' : ''}`}
            aria-pressed={status === filter.value}
            onClick={() => setStatus(filter.value)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner label="Loading bugs…" />
      ) : error ? (
        <div className="state-block">
          <Alert variant="error">{error}</Alert>
          <button type="button" className="btn btn--secondary" onClick={() => setReloadToken((n) => n + 1)}>
            Try again
          </button>
        </div>
      ) : bugs.length === 0 ? (
        <div className="empty-state">
          <h2 className="empty-state__title">
            {status === 'all' ? 'No bugs yet' : `No ${status.replace('-', ' ')} bugs`}
          </h2>
          <p className="empty-state__text">
            {status === 'all'
              ? 'Create your first bug report to get started.'
              : 'Try a different status filter.'}
          </p>
          {status === 'all' ? (
            <Link to="/bugs/new" className="btn btn--primary">
              Create bug
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className="bug-grid">
          {bugs.map((bug) => (
            <li key={bug.id}>
              <Link to={`/bugs/${bug.id}`} className="bug-card">
                <div className="bug-card__head">
                  <h2 className="bug-card__title">{bug.title}</h2>
                </div>
                <p className="bug-card__description">{bug.description}</p>
                <div className="bug-card__meta">
                  <SeverityBadge severity={bug.severity} />
                  <StatusBadge status={bug.status} />
                  <span className="bug-card__date">{formatDateTime(bug.createdAt)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
