import { Fragment } from 'react';
import { Check, Lock } from 'lucide-react';
import { cn } from '../../lib/utils';

export type StageState = 'done' | 'current' | 'locked';

export interface RailStage<Id extends string = string> {
  id: Id;
  label: string;
  sub?: string;
  state: StageState;
  n: number;
}

/**
 * The case "progress spine": shows the whole pipeline and where this case is
 * (done / current / locked). Presentational only — gating is computed by the caller.
 * Unlocked stages are clickable so it guides without trapping you.
 */
export default function StageRail<Id extends string>({
  stages,
  activeId,
  onSelect,
}: {
  stages: RailStage<Id>[];
  activeId: Id | null;
  onSelect: (id: Id) => void;
}) {
  return (
    <div className="card p-5 sm:p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="text-sm font-semibold text-foreground">Case progress</div>
        <div className="text-xs text-muted-foreground hidden sm:block">Click any unlocked stage</div>
      </div>
      <div className="flex items-start">
        {stages.map((s, i) => {
          const clickable = s.state !== 'locked';
          const active = s.id === activeId;
          return (
            <Fragment key={s.id}>
              {i > 0 && (
                <div className={cn('flex-1 h-0.5 mt-4', s.state === 'locked' ? 'bg-border' : 'bg-primary')} />
              )}
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onSelect(s.id)}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex flex-col items-center text-center w-[4.5rem] sm:w-28 shrink-0',
                  clickable ? 'cursor-pointer' : 'cursor-not-allowed',
                )}
              >
                <span
                  className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors',
                    s.state === 'done' && 'bg-primary text-primary-foreground',
                    s.state === 'current' && 'bg-card border-2 border-primary text-primary ring-4 ring-primary/15',
                    s.state === 'locked' && 'bg-muted border border-border text-muted-foreground',
                    active && s.state === 'done' && 'ring-4 ring-primary/20',
                  )}
                >
                  {s.state === 'done' ? <Check className="w-4 h-4" strokeWidth={3} /> : s.state === 'locked' ? <Lock className="w-3.5 h-3.5" /> : s.n}
                </span>
                <span
                  className={cn(
                    'mt-2 text-[11px] sm:text-xs font-semibold leading-tight',
                    s.state === 'locked' ? 'text-muted-foreground' : active ? 'text-primary' : 'text-foreground',
                  )}
                >
                  {s.label}
                </span>
                {s.sub && (
                  <span className={cn('text-[10px] sm:text-[11px] leading-tight mt-0.5', s.state === 'current' ? 'text-primary/80' : 'text-muted-foreground/80')}>
                    {s.sub}
                  </span>
                )}
              </button>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
