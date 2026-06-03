import React, { useRef } from 'react';

export interface TabItem<Id extends string = string> {
  id: Id;
  label: string;
  icon?: React.ElementType;
  badge?: React.ReactNode;
  disabled?: boolean;
  /** Tooltip shown when disabled (explains what unlocks the tab). */
  disabledHint?: string;
}

interface TabBarProps<Id extends string = string> {
  tabs: TabItem<Id>[];
  activeTab: Id;
  onChange: (id: Id) => void;
  className?: string;
}

export default function TabBar<Id extends string = string>({ tabs, activeTab, onChange, className = '' }: TabBarProps<Id>) {
  const ref = useRef<HTMLDivElement>(null);

  // Arrow-key navigation across enabled tabs (standard tablist behavior).
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const enabled = tabs.filter((t) => !t.disabled);
    const idx = enabled.findIndex((t) => t.id === activeTab);
    if (idx === -1) return;
    const next = e.key === 'ArrowRight' ? enabled[(idx + 1) % enabled.length] : enabled[(idx - 1 + enabled.length) % enabled.length];
    onChange(next.id);
    e.preventDefault();
  }

  return (
    <div className={`border-b border-border ${className}`}>
      <nav ref={ref} className="flex gap-1 overflow-x-auto -mb-px" role="tablist" aria-label="Case sections" onKeyDown={onKeyDown}>
        {tabs.map(({ id, label, icon: Icon, badge, disabled, disabledHint }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              aria-disabled={disabled || undefined}
              title={disabled ? disabledHint : undefined}
              tabIndex={active ? 0 : -1}
              onClick={() => { if (!disabled) onChange(id); }}
              className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                active
                  ? 'border-primary text-primary'
                  : disabled
                  ? 'border-transparent text-muted-foreground/40 cursor-not-allowed'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              {Icon && <Icon className="w-4 h-4" />}
              {label}
              {badge}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
