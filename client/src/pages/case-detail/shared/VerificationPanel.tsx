import { CheckCircle2, AlertTriangle, XCircle, CircleDashed, ShieldCheck } from 'lucide-react';
import Badge, { type Tone } from '../../../components/ui/Badge';
import type { DocumentVerification } from '../../../types';

const STATUS_CONFIG: Record<DocumentVerification['overallStatus'], { tone: Tone; label: string; Icon: React.ElementType }> = {
  verified: { tone: 'success', label: 'Verified', Icon: CheckCircle2 },
  review_needed: { tone: 'warning', label: 'Review Needed', Icon: AlertTriangle },
  issues_found: { tone: 'danger', label: 'Issues Found', Icon: XCircle },
};

const CHECK_ICON: Record<string, { Icon: React.ElementType; cls: string }> = {
  ok: { Icon: CheckCircle2, cls: 'text-emerald-500' },
  missing: { Icon: CircleDashed, cls: 'text-amber-500' },
  mismatch: { Icon: XCircle, cls: 'text-red-500' },
  hallucinated: { Icon: XCircle, cls: 'text-red-600' },
};

export function VerificationPanel({
  verification: v,
  title = 'AI Verification',
}: {
  verification: DocumentVerification;
  title?: string;
}) {
  const cfg = STATUS_CONFIG[v.overallStatus];
  const StatusIcon = cfg.Icon;
  const issues = v.checks.filter(c => c.status !== 'ok');
  const okCount = v.checks.filter(c => c.status === 'ok').length;

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
        <ShieldCheck className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground">{title}</div>
        </div>
        {v.didRetry && <Badge tone="info" size="sm">Auto-corrected</Badge>}
        <Badge tone={cfg.tone} icon={<StatusIcon className="w-3 h-3" />}>{cfg.label}</Badge>
      </div>
      <div className="px-5 py-4 space-y-3">
        <p className="text-sm text-foreground leading-relaxed">{v.summary}</p>
        <div className="flex items-center gap-2 text-xs">
          <Badge tone="success" size="sm"><CheckCircle2 className="w-3 h-3" />{okCount} verified</Badge>
          {issues.length > 0 && (
            <Badge tone={issues.some(c => c.status === 'mismatch' || c.status === 'hallucinated') ? 'danger' : 'warning'} size="sm">
              <AlertTriangle className="w-3 h-3" />{issues.length} flagged
            </Badge>
          )}
        </div>
        {issues.length > 0 && (
          <ul className="divide-y divide-border border-t border-border pt-2">
            {issues.map((check, i) => {
              const ic = CHECK_ICON[check.status] ?? CHECK_ICON.mismatch;
              const Icon = ic.Icon;
              return (
                <li key={i} className="flex items-start gap-2 py-2 text-sm">
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${ic.cls}`} />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-foreground">{check.field}</span>
                    {check.note && <span className="text-muted-foreground"> — {check.note}</span>}
                    {(check.expected || check.found) && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {check.expected && <>Expected: <span className="text-muted-foreground">{check.expected}</span></>}
                        {check.found && check.status !== 'ok' && <span className="ml-3">Found: <span className="text-muted-foreground">{check.found}</span></span>}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {v.blankFields.length > 0 && (
          <div className="text-xs text-muted-foreground border-t border-border pt-2">
            <span className="font-semibold">Blank / UNKNOWN fields:</span> {v.blankFields.join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}
