import Badge, { type Tone } from './Badge';
import type { CaseStatus } from '../../types';
import { STATUS_LABELS } from '../../lib/utils';

const STATUS_TONES: Record<CaseStatus, Tone> = {
  DRAFT: 'neutral',
  ASSEMBLING: 'info',
  ANALYZING: 'info',
  STRATEGY_PENDING: 'warning',
  STRATEGY_SELECTED: 'info',
  GENERATING: 'info',
  READY: 'success',
  SENT: 'success',
  AWAITING_RESPONSE: 'info',
  ESCALATING: 'warning',
  RESOLVED: 'success',
  CLOSED: 'neutral',
};

export default function StatusPill({
  status,
  size = 'md',
}: {
  status: CaseStatus;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <Badge tone={STATUS_TONES[status]} size={size}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export { STATUS_TONES };
