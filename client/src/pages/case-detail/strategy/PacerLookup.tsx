import LookupCard from './LookupCard';
import Badge, { type Tone } from '../../../components/ui/Badge';
import type { Case } from '../../../types';
import type { PacerResult } from './lookupTypes';

const headlineTone = (r: PacerResult): Tone => {
  if (r.activeCases > 0) return 'danger';
  if (r.found) return 'warning';
  return 'success';
};

export default function PacerLookup({ caseData }: { caseData: Case }) {
  return (
    <LookupCard<PacerResult>
      caseData={caseData}
      lookupKey="pacer"
      field="pacerResult"
      title="Federal Bankruptcy (PACER)"
      description="Check PACER for active federal bankruptcy filings. An active automatic stay means you cannot collect — attempting to do so is a federal violation."
      runLabel="Check Bankruptcy"
      runningLabel="Checking PACER…"
      render={(result) => result.error ? (
        <div className="text-xs space-y-1">
          <p className="text-red-600">{result.error}</p>
          {result.scraperNote && <p className="text-muted-foreground italic">{result.scraperNote}</p>}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone={headlineTone(result)} size="sm">
              {result.activeCases > 0
                ? 'Active bankruptcy — automatic stay in effect'
                : result.found
                ? `${result.totalCases} historical case(s) — no active stay`
                : 'No bankruptcy filings — safe to proceed'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{result.note}</p>
          {result.cases.length > 0 && (
            <div className="space-y-2">
              {result.cases.map((bc, i) => (
                <div key={i} className="p-2.5 rounded border border-border bg-card text-xs space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-semibold text-foreground">{bc.caseNumber}</span>
                    <Badge tone={bc.automaticStayActive ? 'danger' : bc.status === 'Discharged' ? 'warning' : 'neutral'} size="sm">
                      {bc.status}
                    </Badge>
                    {bc.chapter !== 'unknown' && <span className="text-muted-foreground">Ch. {bc.chapter}</span>}
                    {bc.dateFiled && <span className="text-muted-foreground">Filed {bc.dateFiled}</span>}
                  </div>
                  {bc.court && <p className="text-muted-foreground">{bc.court}</p>}
                  {bc.proofOfClaimDeadline && (
                    <p className="text-amber-700 font-medium">Proof of claim deadline: {bc.proofOfClaimDeadline}</p>
                  )}
                  <p className="text-muted-foreground leading-relaxed border-t border-border pt-1 mt-1">{bc.actionRequired}</p>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">Source: PACER (pacer.uscourts.gov) — federal courts only.</p>
        </>
      )}
    />
  );
}
