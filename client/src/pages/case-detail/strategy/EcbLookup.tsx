import LookupCard from './LookupCard';
import Badge, { type Tone } from '../../../components/ui/Badge';
import type { Case } from '../../../types';
import type { EcbResult } from './lookupTypes';

const outstandingTone = (amount: number): Tone =>
  amount > 50000 ? 'danger' : amount > 5000 ? 'warning' : 'neutral';

export default function EcbLookup({ caseData }: { caseData: Case }) {
  return (
    <LookupCard<EcbResult>
      caseData={caseData}
      lookupKey="ecb"
      field="ecbResult"
      title="NYC Code Violations (ECB/OATH)"
      description="Check for unpaid NYC code violation fines. Large outstanding balances are a collectability red flag."
      runLabel="Check Violations"
      render={(result) => result.error ? (
        <p className="text-xs text-red-600">{result.error}</p>
      ) : result.found ? (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone="neutral" size="sm">{result.totalViolations} violation(s)</Badge>
            {result.totalOutstanding > 0 && (
              <Badge tone={outstandingTone(result.totalOutstanding)} size="sm">
                ${result.totalOutstanding.toLocaleString()} outstanding
              </Badge>
            )}
            {result.totalOutstanding === 0 && <Badge tone="success" size="sm">All paid / dismissed</Badge>}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{result.note}</p>
          {result.violations.length > 0 && (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {result.violations.slice(0, 6).map((v, i) => (
                <div key={i} className="flex gap-2 text-xs p-1.5 rounded border border-border bg-card">
                  <span className={`shrink-0 font-semibold ${(v.outstandingAmount ?? 0) > 0 ? 'text-amber-700' : 'text-muted-foreground'}`}>
                    {(v.outstandingAmount ?? 0) > 0 ? `$${v.outstandingAmount!.toLocaleString()} owed` : 'Paid'}
                  </span>
                  <span className="text-muted-foreground truncate">{v.violationType || v.hearingStatus}</span>
                  {v.issueDate && <span className="text-muted-foreground shrink-0">{v.issueDate.slice(0, 10)}</span>}
                </div>
              ))}
              {result.violations.length > 6 && (
                <p className="text-xs text-muted-foreground">+{result.violations.length - 6} more</p>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground leading-relaxed">{result.note}</p>
      )}
    />
  );
}
