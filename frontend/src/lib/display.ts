import type { BugSeverity, BugStatus } from '../api/types'

/** Display labels for the backend enums. Keys must match backend values exactly. */
export const SEVERITY_LABELS: Record<BugSeverity, string> = {
  low: 'Low',
  med: 'Medium',
  high: 'High',
}

export const STATUS_LABELS: Record<BugStatus, string> = {
  open: 'Open',
  'in-progress': 'In Progress',
  closed: 'Closed',
}

/** Filter tabs for the dashboard. `all` omits the `status` query parameter. */
export type StatusFilter = BugStatus | 'all'

export const STATUS_FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'closed', label: 'Closed' },
]

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

/** Formats an ISO timestamp from the API; falls back to a dash for bad input. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '—'
  }

  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date)
}
