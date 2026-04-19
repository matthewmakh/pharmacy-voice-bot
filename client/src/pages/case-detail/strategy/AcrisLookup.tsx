import { useState } from 'react';
import { lookupACRIS } from '../../../lib/api';
import LookupCard from './LookupCard';
import Badge from '../../../components/ui/Badge';
import type { AcrisResult } from './lookupTypes';

export default function AcrisLookup({ caseId }: { caseId: string }) {
  const [result, setResult] = useState<AcrisResult | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      setResult(await lookupACRIS(caseId));
    } catch {
      setResult({ found: false, totalRecords: 0, asGrantee: 0, asGrantor: 0, searchedName: '', note: '', error: 'Lookup failed' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <LookupCard
      title="NYC Property Records (ACRIS)"
      description="Check if the debtor owns NYC real property — a post-judgment lien can prevent them from selling or refinancing."
      loading={loading}
      hasResult={!!result}
      onRun={run}
      runLabel="Run ACRIS Lookup"
    >
      {result?.error ? (
        <p className="text-xs text-slate-500">{result.error}</p>
      ) : result && (
        <>
          <div className="flex items-center gap-2 text-xs">
            <Badge tone={result.found ? 'success' : 'neutral'} size="sm">
              {result.found ? `${result.totalRecords} record(s) found` : 'No records found'}
            </Badge>
            {result.found && <span className="text-slate-400">· {result.searchedName}</span>}
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">{result.note}</p>
          {result.found && (
            <p className="text-xs text-slate-400">
              Verify at: <strong>a836-acris.nyc.gov</strong> → Document Search → Party Name Search
            </p>
          )}
        </>
      )}
    </LookupCard>
  );
}
