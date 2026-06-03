import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { triggerLookup, getErrorMessage, type LookupKey } from '../../../lib/api';
import type { Case } from '../../../types';

interface LookupCardProps<T> {
  caseData: Case;
  lookupKey: LookupKey;
  /** Case field holding the persisted result. */
  field: keyof Case;
  title: string;
  description: string;
  runLabel?: string;
  runningLabel?: string;
  render: (result: T) => React.ReactNode;
}

/**
 * Generic controller for a debtor-research lookup. The lookup runs in the BACKGROUND
 * on the server (UCC/PACER take 40–90s), so this reads the persisted result + status
 * from the case (which the case page polls) rather than blocking on the request. The
 * result survives a page refresh because it lives on the case, not in local state.
 */
export default function LookupCard<T>({
  caseData,
  lookupKey,
  field,
  title,
  description,
  runLabel = 'Run Lookup',
  runningLabel = 'Searching…',
  render,
}: LookupCardProps<T>) {
  const queryClient = useQueryClient();
  const meta = (caseData.lookupMeta ?? {})[lookupKey];
  const result = (caseData[field] as unknown as T | null) ?? null;
  const running = meta?.status === 'running';

  const mutation = useMutation({
    mutationFn: () => triggerLookup(caseData.id, lookupKey),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });

  const busy = running || mutation.isPending;
  const hasResult = !!result && !running;
  const runError = meta?.status === 'error' ? meta.error : null;
  const triggerError = mutation.isError ? getErrorMessage(mutation.error) : null;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="kbd-label">{title}</span>
        <button
          onClick={() => mutation.mutate()}
          disabled={busy}
          className="text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 font-medium inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
        >
          {busy ? (
            <><Loader2 className="w-3 h-3 animate-spin" />{runningLabel}</>
          ) : hasResult ? (
            <><RefreshCw className="w-3 h-3" />Refresh</>
          ) : (
            runLabel
          )}
        </button>
      </div>

      {busy && (
        <p className="text-xs text-muted-foreground leading-relaxed">Running in the background — this can take up to a minute and keeps going if you navigate away.</p>
      )}
      {!busy && !hasResult && !runError && !triggerError && (
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
      )}
      {(runError || triggerError) && !busy && (
        <p className="text-xs text-red-600 flex items-center gap-1.5"><AlertCircle className="w-3 h-3 shrink-0" />{runError || triggerError}</p>
      )}
      {hasResult && <div className="space-y-2">{render(result as T)}</div>}
      {hasResult && meta?.fetchedAt && (
        <p className="text-[11px] text-muted-foreground/60 mt-2">Checked {new Date(meta.fetchedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
      )}
    </div>
  );
}
