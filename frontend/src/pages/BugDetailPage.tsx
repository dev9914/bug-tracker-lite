import { useEffect, useState, type ChangeEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { deleteBug, getBug, getBugImageUrl } from '../api/bugs'
import { getErrorMessage } from '../api/client'
import type { Bug } from '../api/types'
import { MAX_IMAGE_MB, IMAGE_ACCEPT_ATTRIBUTE, uploadBugImage } from '../api/uploads'
import { Alert } from '../components/Alert'
import { SeverityBadge, StatusBadge } from '../components/Badge'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Spinner } from '../components/Spinner'
import { formatDateTime } from '../lib/display'

interface LocationState {
  flash?: string
}

export function BugDetailPage() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()

  const [bug, setBug] = useState<Bug | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [flash, setFlash] = useState<string | null>(
    () => (location.state as LocationState | null)?.flash ?? null,
  )

  // The presigned image URL is short-lived, so it is fetched rather than stored.
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageLoading, setImageLoading] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [imageReloadToken, setImageReloadToken] = useState(0)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadBug() {
      if (!id) {
        setError('Missing bug id.')
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      try {
        const result = await getBug(id)

        if (!cancelled) {
          setBug(result)
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(getErrorMessage(requestError))
          setBug(null)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadBug()

    return () => {
      cancelled = true
    }
  }, [id, reloadToken])

  const imageKey = bug?.imageKey ?? null
  const bugId = bug?.id

  useEffect(() => {
    let cancelled = false

    async function loadImage() {
      if (!bugId || !imageKey) {
        setImageUrl(null)
        setImageError(null)
        return
      }

      setImageLoading(true)
      setImageError(null)

      try {
        const image = await getBugImageUrl(bugId)

        if (!cancelled) {
          setImageUrl(image.url)
        }
      } catch (requestError) {
        if (!cancelled) {
          setImageUrl(null)
          setImageError(getErrorMessage(requestError))
        }
      } finally {
        if (!cancelled) {
          setImageLoading(false)
        }
      }
    }

    void loadImage()

    return () => {
      cancelled = true
    }
  }, [bugId, imageKey, imageReloadToken])

  async function handleDelete() {
    if (!bug) {
      return
    }

    setDeleting(true)
    setActionError(null)

    try {
      await deleteBug(bug.id)
      navigate('/dashboard', { replace: true, state: { flash: 'Bug deleted.' } })
    } catch (requestError) {
      setDeleting(false)
      setConfirmOpen(false)
      setActionError(getErrorMessage(requestError))
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Reset so choosing the same file again still fires a change event.
    event.target.value = ''

    if (!file || !bug) {
      return
    }

    setUploadError(null)
    setFlash(null)
    setUploadProgress(0)
    setUploadBusy(true)

    try {
      const updated = await uploadBugImage(bug.id, file, setUploadProgress)
      setBug(updated)
      setFlash('Image uploaded and attached.')
    } catch (requestError) {
      setUploadError(getErrorMessage(requestError))
    } finally {
      setUploadBusy(false)
      setUploadProgress(0)
    }
  }

  if (loading) {
    return <Spinner label="Loading bug…" />
  }

  if (error || !bug) {
    return (
      <div className="page page--narrow">
        <Alert variant="error">{error ?? 'Bug not found.'}</Alert>
        <div className="state-block">
          <Link to="/dashboard" className="btn btn--secondary">
            Back to dashboard
          </Link>
          <button type="button" className="btn btn--ghost" onClick={() => setReloadToken((n) => n + 1)}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to="/dashboard">Dashboard</Link>
        <span aria-hidden="true">/</span>
        <span>{bug.title}</span>
      </div>

      {flash ? <Alert variant="success">{flash}</Alert> : null}
      {actionError ? <Alert variant="error">{actionError}</Alert> : null}

      <article className="card detail">
        <header className="detail__header">
          <h1 className="detail__title">{bug.title}</h1>
          <div className="detail__badges">
            <SeverityBadge severity={bug.severity} />
            <StatusBadge status={bug.status} />
          </div>
        </header>

        <dl className="detail__meta">
          <div>
            <dt>Created</dt>
            <dd>{formatDateTime(bug.createdAt)}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatDateTime(bug.updatedAt)}</dd>
          </div>
        </dl>

        <section className="detail__section">
          <h2 className="detail__section-title">Description</h2>
          <p className="detail__description">{bug.description}</p>
        </section>

        <section className="detail__section">
          <h2 className="detail__section-title">Attachment</h2>

          {imageLoading ? <Spinner label="Loading image…" /> : null}

          {!imageLoading && imageError ? (
            <div className="state-block">
              <Alert variant="error">{imageError}</Alert>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => setImageReloadToken((n) => n + 1)}
              >
                Reload image
              </button>
            </div>
          ) : null}

          {!imageLoading && !imageError && imageUrl ? (
            <figure className="attachment">
              <img src={imageUrl} alt={`Attachment for ${bug.title}`} className="attachment__img" />
            </figure>
          ) : null}

          {!imageLoading && !imageError && !imageUrl ? (
            <p className="detail__empty">No image attached yet.</p>
          ) : null}

          <div className="upload">
            <label className="btn btn--secondary btn--sm upload__label" htmlFor="bug-image-input">
              {bug.imageKey ? 'Replace image' : 'Upload image'}
            </label>
            <input
              id="bug-image-input"
              className="upload__input"
              type="file"
              accept={IMAGE_ACCEPT_ATTRIBUTE}
              onChange={handleFileChange}
              disabled={uploadBusy}
            />
            <span className="upload__hint">JPG, PNG or WebP, up to {MAX_IMAGE_MB} MB.</span>
          </div>

          {uploadBusy ? (
            <div className="progress" role="progressbar" aria-valuenow={uploadProgress} aria-valuemin={0} aria-valuemax={100}>
              <div className="progress__bar" style={{ width: `${uploadProgress}%` }} />
              <span className="progress__label">Uploading… {uploadProgress}%</span>
            </div>
          ) : null}

          {uploadError ? <Alert variant="error">{uploadError}</Alert> : null}
        </section>

        <footer className="detail__actions">
          <Link to={`/bugs/${bug.id}/edit`} className="btn btn--primary">
            Edit bug
          </Link>
          <button type="button" className="btn btn--danger" onClick={() => setConfirmOpen(true)}>
            Delete bug
          </button>
        </footer>
      </article>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete this bug?"
        message="This permanently removes the bug and its uploaded image. This cannot be undone."
        confirmLabel="Delete bug"
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
