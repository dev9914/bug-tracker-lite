import type { BugSeverity, BugStatus } from '../api/types'
import { SEVERITY_LABELS, STATUS_LABELS } from '../lib/display'

export function SeverityBadge({ severity }: { severity: BugSeverity }) {
  return <span className={`badge badge--severity-${severity}`}>{SEVERITY_LABELS[severity]}</span>
}

export function StatusBadge({ status }: { status: BugStatus }) {
  return <span className={`badge badge--status-${status}`}>{STATUS_LABELS[status]}</span>
}
