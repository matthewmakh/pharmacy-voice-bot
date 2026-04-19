import React from 'react';
import { Loader2 } from 'lucide-react';

interface LookupCardProps {
  title: string;
  description: string;
  loading: boolean;
  hasResult: boolean;
  onRun: () => void;
  onRefresh?: () => void;
  runLabel?: string;
  runningLabel?: string;
  children?: React.ReactNode;
}

export default function LookupCard({
  title,
  description,
  loading,
  hasResult,
  onRun,
  onRefresh,
  runLabel = 'Run Lookup',
  runningLabel = 'Searching…',
  children,
}: LookupCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="kbd-label">{title}</span>
        {!hasResult ? (
          <button
            onClick={onRun}
            disabled={loading}
            className="text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 font-medium inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            {loading ? <><Loader2 className="w-3 h-3 animate-spin" />{runningLabel}</> : runLabel}
          </button>
        ) : (
          <button
            onClick={onRefresh ?? onRun}
            disabled={loading}
            className="text-xs text-slate-400 hover:text-slate-600"
          >
            {loading ? 'Searching…' : 'Refresh'}
          </button>
        )}
      </div>
      {!hasResult && !loading && (
        <p className="text-xs text-slate-500 leading-relaxed">{description}</p>
      )}
      {hasResult && <div className="space-y-2">{children}</div>}
    </div>
  );
}
