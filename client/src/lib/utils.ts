import type { CaseStatus, Strategy } from '../types';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function formatCurrency(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return value;
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const STATUS_LABELS: Record<CaseStatus, string> = {
  DRAFT: 'Draft',
  ASSEMBLING: 'Assembling',
  ANALYZING: 'Analyzing',
  STRATEGY_PENDING: 'Awaiting Strategy',
  STRATEGY_SELECTED: 'Ready to Generate',
  GENERATING: 'Generating',
  READY: 'Letter Ready',
  SENT: 'Letter Sent',
  AWAITING_RESPONSE: 'Awaiting Response',
  ESCALATING: 'Escalating',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export const STATUS_TONES: Record<CaseStatus, Tone> = {
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

export const STRATEGY_LABELS: Record<Strategy, string> = {
  QUICK_ESCALATION: 'Quick Escalation',
  STANDARD_RECOVERY: 'Standard Recovery',
  GRADUAL_APPROACH: 'Gradual Approach',
};

export const DOC_CLASSIFICATION_LABELS: Record<string, string> = {
  contract: 'Contract',
  invoice: 'Invoice',
  proof_of_work: 'Proof of Work',
  communication: 'Communication',
  payment_record: 'Payment Record',
  business_record: 'Business Record',
  screenshot: 'Screenshot',
  other: 'Other',
};

export const DOC_CLASSIFICATION_TONES: Record<string, Tone> = {
  contract: 'info',
  invoice: 'success',
  proof_of_work: 'info',
  communication: 'neutral',
  payment_record: 'success',
  business_record: 'neutral',
  screenshot: 'neutral',
  other: 'neutral',
};

export const STRENGTH_TONES: Record<string, Tone> = {
  strong: 'success',
  moderate: 'warning',
  weak: 'danger',
};
