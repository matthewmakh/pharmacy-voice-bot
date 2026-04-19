import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface SectionCardProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}

const PAD: Record<NonNullable<SectionCardProps['padding']>, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

export default function SectionCard({
  title,
  description,
  icon,
  action,
  collapsible = false,
  defaultOpen = true,
  padding = 'md',
  className = '',
  headerClassName = '',
  bodyClassName = '',
  children,
}: SectionCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const hasHeader = !!(title || description || action || icon || collapsible);

  const toggle = () => collapsible && setOpen(o => !o);

  return (
    <section className={`bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden ${className}`}>
      {hasHeader && (
        <header
          className={`flex items-start gap-3 ${collapsible ? 'cursor-pointer select-none' : ''} ${
            open && children ? 'border-b border-slate-100' : ''
          } px-5 py-4 ${headerClassName}`}
          onClick={toggle}
          role={collapsible ? 'button' : undefined}
          tabIndex={collapsible ? 0 : undefined}
          onKeyDown={collapsible ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } } : undefined}
        >
          {icon && <div className="shrink-0 text-slate-500 mt-0.5">{icon}</div>}
          <div className="flex-1 min-w-0">
            {title && <h3 className="text-sm font-semibold text-slate-900">{title}</h3>}
            {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
          </div>
          {action && <div onClick={(e) => e.stopPropagation()} className="shrink-0 flex items-center gap-2">{action}</div>}
          {collapsible && (
            <ChevronDown
              className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          )}
        </header>
      )}
      {open && <div className={`${PAD[padding]} ${bodyClassName}`}>{children}</div>}
    </section>
  );
}
