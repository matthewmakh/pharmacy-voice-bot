import { useState } from 'react';
import { lookupPACERBankruptcy } from '../../../lib/api';
import LookupCard from './LookupCard';
import Badge, { type Tone } from '../../../components/ui/Badge';
import type { PacerResult } from './lookupTypes';

export default function PacerLookup({ caseId }: { caseId: string }) {
  const [result, setResult] = useState<PacerResult | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      setResult(await lookupPACERBankruptcy(caseId));
    } catch {
      setResult({ found: false, totalCases: 0, activeCases: 0, cases: [], searchedName: '', note: '', error: 'PACER lookup failed' });
    } finally {
      setLoading(false);
    }
  };

  const headlineTone = (r: PacerResult): Tone => {
    if (r.activeCases > 0) return 'danger';
    if (r.found) return 'warning';
    return 'success';
  };

  return (
    <LookupCard
      title="Federal Bankruptcy (PACER)"
      description="Check PACER for active federal bankruptcy filings. An active automatic stay means you cannot collect — attempting to do so is a federal violation."
      loading={loading}
      hasResult={!!result}
      onRun={run}
      runLabel="Check Bankruptcy"
      runningLabel="Checking PACER…"
    >
      {result?.error ? (
        <div className="text-xs space-y-1">
          <p className="text-red-600">{result.error}</p>
          {result.scraperNote && <p className="text-slate-400 italic">{result.scraperNote}</p>}
        </div>
      ) : result && (
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
          <p className="text-xs text-slate-600 leading-relaxed">{result.note}</p>
          {result.cases.length > 0 && (
            <div className="space-y-2">
              {result.cases.map((bc, i) => (
                <div key={i} className="p-2.5 rounded border border-slate-200 bg-white text-xs space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-semibold text-slate-700">{bc.caseNumber}</span>
                    <Badge
                      tone={bc.automaticStayActive ? 'danger' : bc.status === 'Discharged' ? 'warning' : 'neutral'}
                      size="sm"
                    >
                      {bc.status}
                    </Badge>
                    {bc.chapter !== 'unknown' && <span className="text-slate-500">Ch. {bc.chapter}</span>}
                    {bc.dateFiled && <span className="text-slate-400">Filed {bc.dateFiled}</span>}
                  </div>
                  {bc.court && <p className="text-slate-500">{bc.court}</p>}
                  {bc.proofOfClaimDeadline && (
                    <p className="text-amber-700 font-medium">Proof of claim deadline: {bc.proofOfClaimDeadline}</p>
                  )}
                  <p className="text-slate-600 leading-relaxed border-t border-slate-100 pt-1 mt-1">{bc.actionRequired}</p>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-400">Source: PACER (pacer.uscourts.gov) — federal courts only.</p>
        </>
      )}
    </LookupCard>
  );
}
