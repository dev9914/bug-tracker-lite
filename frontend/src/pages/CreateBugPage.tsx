import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { attachBugImage, createBug } from '../api/bugs'
import { getErrorMessage, getFieldErrors } from '../api/client'
import { BUG_SEVERITIES, BUG_STATUSES, type BugSeverity, type BugStatus } from '../api/types'
import { uploadImageToS3 } from '../api/uploads'
import { Alert } from '../components/Alert'
import { ImagePicker } from '../components/ImagePicker'
import { SEVERITY_LABELS, STATUS_LABELS } from '../lib/display'

const TITLE_MAX = 200
const DESCRIPTION_MAX = 5000

type Stage = 'create' | 'upload' | 'attach'
type Phase = 'idle' | 'creating' | 'uploading' | 'attaching'

interface FieldErrors {
  title?: string
  description?: string
}

interface StageError {
  stage: Stage
  message: string
}

const STAGE_MESSAGES: Record<Stage, string> = {
  create: 'The bug could not be created.',
  upload: 'The bug was created, but the image could not be uploaded to storage.',
  attach: 'The bug was created and the image uploaded, but it could not be attached.',
}

export function CreateBugPage() {
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<BugSeverity>('med')
  const [status, setStatus] = useState<BugStatus>('open')

  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  // Remembered after a partial success so a retry never creates a second bug.
  const [createdBugId, setCreatedBugId] = useState<string | null>(null)
  // Key already PUT to S3, kept so a retry only re-runs the attach step.
  const [uploadedKey, setUploadedKey] = useState<string | null>(null)

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [stageError, setStageError] = useState<StageError | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)

  const busy = phase !== 'idle'
  const fieldsLocked = busy || createdBugId !== null

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

    // Once the bug exists the fields are locked, so only validate before creating.
    if (!createdBugId && !validate()) {
      return
    }

    let bugId = createdBugId

    if (!bugId) {
      setPhase('creating')

      try {
        // Only fields accepted by createBugSchema are sent; the image is attached later.
        const bug = await createBug({
          title: title.trim(),
          description: description.trim(),
          severity,
          status,
        })

        bugId = bug.id
        setCreatedBugId(bug.id)
      } catch (submitError) {
        setFieldErrors(getFieldErrors(submitError))
        setStageError({ stage: 'create', message: getErrorMessage(submitError) })
        setPhase('idle')
        return
      }
    }

    if (file) {
      let imageKey = uploadedKey

      if (!imageKey) {
        setPhase('uploading')
        setProgress(0)

        try {
          // Presign + direct browser PUT to S3; bytes never pass through Express.
          imageKey = await uploadImageToS3(file, setProgress)
          setUploadedKey(imageKey)
        } catch (uploadError) {
          setStageError({ stage: 'upload', message: getErrorMessage(uploadError) })
          setPhase('idle')
          return
        }
      }

      setPhase('attaching')

      try {
        await attachBugImage(bugId, imageKey)
      } catch (attachError) {
        setStageError({ stage: 'attach', message: getErrorMessage(attachError) })
        setPhase('idle')
        return
      }
    }

    navigate(`/bugs/${bugId}`, {
      replace: true,
      state: { flash: file ? 'Bug created with an image.' : 'Bug created successfully.' },
    })
  }

  let submitLabel = 'Create bug'

  if (phase === 'creating') {
    submitLabel = 'Creating…'
  } else if (phase === 'uploading') {
    submitLabel = `Uploading… ${progress}%`
  } else if (phase === 'attaching') {
    submitLabel = 'Attaching image…'
  } else if (createdBugId) {
    submitLabel = file ? 'Retry image upload' : 'Finish'
  }

  return (
    <div className="page page--narrow">
      <div className="page__header">
        <div>
          <h1 className="page__title">Create bug</h1>
          <p className="page__subtitle">Describe the issue so it can be triaged.</p>
        </div>
      </div>

      {stageError ? (
        <Alert variant="error">
          {STAGE_MESSAGES[stageError.stage]} {stageError.message}
          {stageError.stage !== 'create'
            ? ' The bug itself was saved — retry the image below, or open the bug and attach it later.'
            : ''}
        </Alert>
      ) : null}

      <form className="form card" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label className="field__label" htmlFor="bug-title">
            Title
          </label>
          <input
            id="bug-title"
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
          <label className="field__label" htmlFor="bug-description">
            Description
          </label>
          <textarea
            id="bug-description"
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
          <ImagePicker file={file} error={fileError} onSelect={handleSelectFile} disabled={busy} />
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
            <label className="field__label" htmlFor="bug-severity">
              Severity
            </label>
            <select
              id="bug-severity"
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
            <label className="field__label" htmlFor="bug-status">
              Status
            </label>
            <select
              id="bug-status"
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
          {createdBugId ? (
            <Link to={`/bugs/${createdBugId}`} className="btn btn--ghost">
              Open bug
            </Link>
          ) : (
            <Link to="/dashboard" className="btn btn--ghost">
              Cancel
            </Link>
          )}
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
