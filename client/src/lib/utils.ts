import type { CaseStatus, Strategy } from '../types';

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

export const STATUS_COLORS: Record<CaseStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  ASSEMBLING: 'bg-blue-100 text-blue-700',
  ANALYZING: 'bg-purple-100 text-purple-700',
  STRATEGY_PENDING: 'bg-amber-100 text-amber-700',
  STRATEGY_SELECTED: 'bg-orange-100 text-orange-700',
  GENERATING: 'bg-purple-100 text-purple-700',
  READY: 'bg-green-100 text-green-700',
  SENT: 'bg-teal-100 text-teal-700',
  AWAITING_RESPONSE: 'bg-sky-100 text-sky-700',
  ESCALATING: 'bg-red-100 text-red-700',
  RESOLVED: 'bg-emerald-100 text-emerald-700',
  CLOSED: 'bg-slate-100 text-slate-500',
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

export const DOC_CLASSIFICATION_COLORS: Record<string, string> = {
  contract: 'bg-blue-100 text-blue-700',
  invoice: 'bg-green-100 text-green-700',
  proof_of_work: 'bg-teal-100 text-teal-700',
  communication: 'bg-purple-100 text-purple-700',
  payment_record: 'bg-emerald-100 text-emerald-700',
  business_record: 'bg-slate-100 text-slate-700',
  screenshot: 'bg-orange-100 text-orange-700',
  other: 'bg-slate-100 text-slate-600',
};

export const STRENGTH_COLORS: Record<string, string> = {
  strong: 'text-emerald-600',
  moderate: 'text-amber-600',
  weak: 'text-red-500',
};
