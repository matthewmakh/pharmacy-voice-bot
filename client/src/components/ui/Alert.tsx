import React from 'react';
import { Info, CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react';
import type { Tone } from './Badge';

const TONE_STYLES: Record<Tone, { wrap: string; icon: string; Icon: React.ElementType }> = {
  neutral: { wrap: 'bg-slate-50 border-slate-200 text-slate-700', icon: 'text-slate-500', Icon: Info },
  info: { wrap: 'bg-blue-50 border-blue-200 text-blue-900', icon: 'text-blue-500', Icon: Info },
  success: { wrap: 'bg-emerald-50 border-emerald-200 text-emerald-900', icon: 'text-emerald-500', Icon: CheckCircle2 },
  warning: { wrap: 'bg-amber-50 border-amber-200 text-amber-900', icon: 'text-amber-500', Icon: AlertTriangle },
  danger: { wrap: 'bg-red-50 border-red-200 text-red-900', icon: 'text-red-500', Icon: AlertCircle },
};

interface AlertProps {
  tone?: Tone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
}

export default function Alert({
  tone = 'neutral',
  title,
  children,
  icon,
  className = '',
  actions,
}: AlertProps) {
  const style = TONE_STYLES[tone];
  const IconComp = style.Icon;
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${style.wrap} ${className}`}>
      <div className={`shrink-0 mt-0.5 ${style.icon}`}>
        {icon ?? <IconComp className="w-4 h-4" />}
      </div>
      <div className="flex-1 min-w-0 text-sm">
        {title && <div className="font-semibold mb-0.5">{title}</div>}
        {children && <div className="text-sm leading-relaxed">{children}</div>}
      </div>
      {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
    </div>
  );
}
