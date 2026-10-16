import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { attachBugImage, getBug, getBugImageUrl, updateBug } from '../api/bugs'
import { getErrorMessage, getFieldErrors } from '../api/client'
import { BUG_SEVERITIES, BUG_STATUSES, type Bug, type BugSeverity, type BugStatus } from '../api/types'
import { uploadImageToS3 } from '../api/uploads'
import { Alert } from '../components/Alert'
import { ImagePicker } from '../components/ImagePicker'
import { Spinner } from '../components/Spinner'
import { SEVERITY_LABELS, STATUS_LABELS } from '../lib/display'

const TITLE_MAX = 200
const DESCRIPTION_MAX = 5000

type Stage = 'update' | 'upload' | 'attach'
type Phase = 'idle' | 'saving' | 'uploading' | 'attaching'

interface FieldErrors {
  title?: string
  description?: string
}

interface StageError {
  stage: Stage
  message: string
}

const STAGE_MESSAGES: Record<Stage, string> = {
  update: 'The bug details could not be saved.',
  upload: 'The bug details were saved, but the replacement image could not be uploaded to storage.',
  attach: 'The bug details were saved and the image uploaded, but it could not be attached.',
}

export function EditBugPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [bug, setBug] = useState<Bug | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<BugSeverity>('med')
  const [status, setStatus] = useState<BugStatus>('open')

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  // The presigned image URL is short-lived, so it is fetched rather than stored.
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(null)
  const [imageLoading, setImageLoading] = useState(false)
  const [imageLoadError, setImageLoadError] = useState<string | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  // Remembered so a retry after a partial failure never saves the fields twice.
  const [detailsSaved, setDetailsSaved] = useState(false)
  // Key already PUT to S3, kept so a retry only re-runs the attach step.
  const [uploadedKey, setUploadedKey] = useState<string | null>(null)

  const [stageError, setStageError] = useState<StageError | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)

  const busy = phase !== 'idle'
  const fieldsLocked = busy || detailsSaved

  useEffect(() => {
    let cancelled = false

    async function loadBug() {
      if (!id) {
        setLoadError('Missing bug id.')
        setLoading(false)
        return
      }

      setLoading(true)
      setLoadError(null)

      try {
        const result = await getBug(id)

        if (cancelled) {
          return
        }

        setBug(result)
        setTitle(result.title)
        setDescription(result.description)
        setSeverity(result.severity)
        setStatus(result.status)
      } catch (requestError) {
        if (!cancelled) {
          setLoadError(getErrorMessage(requestError))
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
  }, [id])

  const imageKey = bug?.imageKey ?? null
  const bugId = bug?.id

  useEffect(() => {
    let cancelled = false

    async function loadImage() {
      if (!bugId || !imageKey) {
        setCurrentImageUrl(null)
        setImageLoadError(null)
        return
      }

      setImageLoading(true)
      setImageLoadError(null)

      try {
        const image = await getBugImageUrl(bugId)

        if (!cancelled) {
          setCurrentImageUrl(image.url)
        }
      } catch (requestError) {
        if (!cancelled) {
          setCurrentImageUrl(null)
          setImageLoadError(getErrorMessage(requestError))
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
  }, [bugId, imageKey])

  function handleSelectFile(selected: File | null, selectionError: string | null) {
    setFile(selected)
    setFileError(selectionError)
    // A new selection invalidates anything uploaded on a previous attempt.
    setUploadedKey(null)
    setStageError(null)
  }

  function validate(): boolean {
    const errors: FieldErrors = {}
    const trimmedTitle = title.trim()
    const trimmedDescription = description.trim()

    if (!trimmedTitle) {
      errors.title = 'Title is required.'
    } else if (trimmedTitle.length > TITLE_MAX) {
      errors.title = `Title must be at most ${TITLE_MAX} characters.`
    }

    if (!trimmedDescription) {
      errors.description = 'Description is required.'
    } else if (trimmedDescription.length > DESCRIPTION_MAX) {
      errors.description = `Description must be at most ${DESCRIPTION_MAX} characters.`
    }

    setFieldErrors(errors)

    return Object.keys(errors).length === 0
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStageError(null)

    if (!bug) {
      return
    }

    // Once the details are saved the fields are locked, so only validate before saving.
    if (!detailsSaved && !validate()) {
      return
    }

    if (!detailsSaved) {
      setPhase('saving')

      try {
        // Only fields accepted by updateBugSchema are sent; imageKey is never editable here.
        await updateBug(bug.id, {
          title: title.trim(),
          description: description.trim(),
          severity,
          status,
        })

        setDetailsSaved(true)
      } catch (submitError) {
        setFieldErrors(getFieldErrors(submitError))
        setStageError({ stage: 'update', message: getErrorMessage(submitError) })
        setPhase('idle')
        return
      }
    }

    if (file) {
      let imageKeyToAttach = uploadedKey

      if (!imageKeyToAttach) {
        setPhase('uploading')
        setProgress(0)

        try {
          // Presign + direct browser PUT to S3; bytes never pass through Express.
          imageKeyToAttach = await uploadImageToS3(file, setProgress)
          setUploadedKey(imageKeyToAttach)
        } catch (uploadError) {
          setStageError({ stage: 'upload', message: getErrorMessage(uploadError) })
          setPhase('idle')
          return
        }
      }

      setPhase('attaching')

      try {
        await attachBugImage(bug.id, imageKeyToAttach)
      } catch (attachError) {
        setStageError({ stage: 'attach', message: getErrorMessage(attachError) })
        setPhase('idle')
        return
      }
    }

    navigate(`/bugs/${bug.id}`, {
      replace: true,
      state: { flash: file ? 'Bug updated and image replaced.' : 'Bug updated successfully.' },
    })
  }

  let submitLabel = 'Save changes'

  if (phase === 'saving') {
    submitLabel = 'Saving…'
  } else if (phase === 'uploading') {
    submitLabel = `Uploading… ${progress}%`
  } else if (phase === 'attaching') {
    submitLabel = 'Attaching image…'
  } else if (detailsSaved) {
    submitLabel = file ? 'Retry image upload' : 'Finish'
  }

  if (loading) {
    return <Spinner label="Loading bug…" />
  }

  if (loadError || !bug) {
    return (
      <div className="page page--narrow">
        <Alert variant="error">{loadError ?? 'Bug not found.'}</Alert>
        <Link to="/dashboard" className="btn btn--secondary">
          Back to dashboard
        </Link>
      </div>
    )
  }

  return (
    <div className="page page--narrow">
      <div className="breadcrumb">
        <Link to="/dashboard">Dashboard</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/bugs/${bug.id}`}>{bug.title}</Link>
        <span aria-hidden="true">/</span>
        <span>Edit</span>
      </div>

      <div className="page__header">
        <div>
          <h1 className="page__title">Edit bug</h1>
          <p className="page__subtitle">Update the details of this report.</p>
        </div>
      </div>

      {stageError ? (
        <Alert variant="error">
          {STAGE_MESSAGES[stageError.stage]} {stageError.message}
          {stageError.stage !== 'update'
            ? ' Your changes were saved — retry the image below, or open the bug and attach it later.'
            : ''}
        </Alert>
      ) : null}

      <form className="form card" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label className="field__label" htmlFor="edit-title">
            Title
          </label>
          <input
            id="edit-title"
            className="input"
            type="text"
            value={title}
            maxLength={TITLE_MAX}
            onChange={(event) => setTitle(event.target.value)}
            aria-invalid={Boolean(fieldErrors.title)}
            disabled={fieldsLocked}
          />
          {fieldErrors.title ? <p className="field__error">{fieldErrors.title}</p> : null}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="edit-description">
            Description
          </label>
          <textarea
            id="edit-description"
            className="input input--textarea"
            rows={5}
            value={description}
            maxLength={DESCRIPTION_MAX}
            onChange={(event) => setDescription(event.target.value)}
            aria-invalid={Boolean(fieldErrors.description)}
            disabled={fieldsLocked}
          />
          {fieldErrors.description ? <p className="field__error">{fieldErrors.description}</p> : null}
        </div>

        <div className="field">
          <span className="field__label">Attachment (optional)</span>
          <ImagePicker
            file={file}
            error={fileError}
            onSelect={handleSelectFile}
            existingImageUrl={imageLoading ? null : currentImageUrl}
            existingImageLabel="Current image"
            disabled={busy}
          />
          {imageLoading ? <p className="field__hint">Loading current image…</p> : null}
          {!imageLoading && imageLoadError ? (
            <p className="field__error">The current image could not be loaded: {imageLoadError}</p>
          ) : null}
          {!imageLoading && !imageLoadError && !imageKey ? (
            <p className="field__hint">No image attached. Choose a file to add one.</p>
          ) : null}
        </div>

        {phase === 'uploading' ? (
          <div
            className="progress"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="progress__bar" style={{ width: `${progress}%` }} />
            <span className="progress__label">Uploading… {progress}%</span>
          </div>
        ) : null}

        <div className="field-row">
          <div className="field">
            <label className="field__label" htmlFor="edit-severity">
              Severity
            </label>
            <select
              id="edit-severity"
              className="input"
              value={severity}
              onChange={(event) => setSeverity(event.target.value as BugSeverity)}
              disabled={fieldsLocked}
            >
              {BUG_SEVERITIES.map((value) => (
                <option key={value} value={value}>
                  {SEVERITY_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="edit-status">
              Status
            </label>
            <select
              id="edit-status"
              className="input"
              value={status}
              onChange={(event) => setStatus(event.target.value as BugStatus)}
              disabled={fieldsLocked}
            >
              {BUG_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="form__actions">
          <Link to={`/bugs/${bug.id}`} className="btn btn--ghost">
            Cancel
          </Link>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
