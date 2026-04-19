import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';

export function InlineProgress({ startedAt, estimatedSeconds, label }: {
  startedAt: Date;
  estimatedSeconds: number;
  label: string;
}) {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - startedAt.getTime()) / 1000));
  React.useEffect(() => {
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt.getTime()) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  const progress = Math.min(95, (elapsed / estimatedSeconds) * 100);
  return (
    <div className="space-y-1.5 py-1">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
          {label}
        </span>
        <span className="tabular-nums">
          {elapsed < estimatedSeconds ? `~${Math.max(0, estimatedSeconds - elapsed)}s` : 'almost done…'}
        </span>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-1">
        <div
          className="bg-blue-500 h-1 rounded-full transition-all duration-1000"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
