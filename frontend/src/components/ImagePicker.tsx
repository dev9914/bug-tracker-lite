import { useEffect, useId, useState, type ChangeEvent } from 'react'
import { getErrorMessage } from '../api/client'
import { IMAGE_ACCEPT_ATTRIBUTE, MAX_IMAGE_MB, validateImageFile } from '../api/uploads'

interface ImagePickerProps {
  /** The currently selected local file, or null when nothing new is chosen. */
  file: File | null
  /** Validation message for the current selection, owned by the parent form. */
  error: string | null
  /** Reports the validated selection; `error` is set when the file is rejected. */
  onSelect: (file: File | null, error: string | null) => void
  /** Signed URL of an already attached image, kept unless a replacement is chosen. */
  existingImageUrl?: string | null
  existingImageLabel?: string
  disabled?: boolean
}

/**
 * Shared image chooser: type/size validation, filename + preview, and
 * remove/replace. Validation reuses the same helper as the upload flow.
 */
export function ImagePicker({
  file,
  error,
  onSelect,
  existingImageUrl = null,
  existingImageLabel = 'Current image',
  disabled = false,
}: ImagePickerProps) {
  const inputId = useId()
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // Revokes the previous object URL when the selection changes or on unmount.
  useEffect(() => {
    const url = previewUrl

    return () => {
      if (url) {
        URL.revokeObjectURL(url)
      }
    }
  }, [previewUrl])

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null
    // Reset so choosing the same file again still fires a change event.
    event.target.value = ''

    if (!selected) {
      setPreviewUrl(null)
      onSelect(null, null)
      return
    }

    try {
      validateImageFile(selected)
      setPreviewUrl(URL.createObjectURL(selected))
      onSelect(selected, null)
    } catch (validationError) {
      setPreviewUrl(null)
      onSelect(null, getErrorMessage(validationError))
    }
  }

  function handleClear() {
    setPreviewUrl(null)
    onSelect(null, null)
  }

  const showSelection = file !== null && previewUrl !== null
  const showExisting = !showSelection && Boolean(existingImageUrl)

  return (
    <div className="image-picker">
      {showSelection ? (
        <figure className="image-picker__preview">
          <img src={previewUrl ?? undefined} alt="Selected image preview" className="image-picker__img" />
          <figcaption className="image-picker__caption">{file?.name}</figcaption>
        </figure>
      ) : showExisting ? (
        <figure className="image-picker__preview">
          <img src={existingImageUrl ?? undefined} alt={existingImageLabel} className="image-picker__img" />
          <figcaption className="image-picker__caption">
            {existingImageLabel} — kept unless you choose a replacement.
          </figcaption>
        </figure>
      ) : null}

      <div className="upload">
        <label className="btn btn--secondary btn--sm upload__label" htmlFor={inputId}>
          {file ? 'Replace image' : showExisting ? 'Choose replacement' : 'Choose image'}
        </label>
        <input
          id={inputId}
          className="upload__input"
          type="file"
          accept={IMAGE_ACCEPT_ATTRIBUTE}
          onChange={handleChange}
          disabled={disabled}
        />
        {file ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={handleClear} disabled={disabled}>
            Remove
          </button>
        ) : null}
        <span className="upload__hint">JPG, PNG or WebP, up to {MAX_IMAGE_MB} MB.</span>
      </div>

      {error ? <p className="field__error">{error}</p> : null}
    </div>
  )
}
