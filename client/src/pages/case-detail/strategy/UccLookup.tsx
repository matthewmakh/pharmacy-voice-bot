import { useState } from 'react';
import { lookupUCCFilings } from '../../../lib/api';
import LookupCard from './LookupCard';
import Badge from '../../../components/ui/Badge';
import type { UccResult } from './lookupTypes';

export default function UccLookup({ caseId }: { caseId: string }) {
  const [result, setResult] = useState<UccResult | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      setResult(await lookupUCCFilings(caseId));
    } catch {
      setResult({ found: false, totalFilings: 0, activeFilings: 0, filings: [], searchedName: '', note: '', error: 'UCC lookup failed' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <LookupCard
      title="NYS UCC Filings (Secured Creditors)"
      description="Check if any secured creditors have existing UCC liens on debtor assets. A judgment lien is subordinate to prior UCC filings. Requires CAPTCHA solving (~40s)."
      loading={loading}
      hasResult={!!result}
      onRun={run}
      runLabel="Search UCC"
      runningLabel="Solving CAPTCHA…"
    >
      {result?.error ? (
        <div className="text-xs space-y-1">
          <p className="text-red-600">{result.error}</p>
          {result.scraperNote && <p className="text-slate-400 italic">{result.scraperNote}</p>}
        </div>
      ) : result?.found && result.filings.length > 0 ? (
        <>
          <Badge tone={result.activeFilings > 0 ? 'warning' : 'neutral'} size="sm">
            {result.activeFilings > 0
              ? `${result.activeFilings} active of ${result.totalFilings} total`
              : `${result.totalFilings} lapsed — no active liens`}
          </Badge>
          <p className="text-xs text-slate-600 leading-relaxed">{result.note}</p>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {result.filings.slice(0, 8).map((f, i) => (
              <div key={i} className="p-2 rounded border border-slate-200 bg-white text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge tone={f.status === 'Active' ? 'warning' : 'neutral'} size="sm">{f.status}</Badge>
                  <span className="font-medium text-slate-700 truncate">{f.securedParty || '(secured party not shown)'}</span>
                  {f.fileNumber && <span className="text-slate-400 font-mono text-[10px]">#{f.fileNumber}</span>}
                </div>
                {f.fileType && <div className="text-slate-400 mt-0.5">{f.fileType}{f.filingDate ? ` · Filed ${f.filingDate}` : ''}{f.lapseDate ? ` · Lapses ${f.lapseDate}` : ''}</div>}
                {f.collateral && <div className="text-slate-500 mt-0.5 line-clamp-2">Collateral: {f.collateral}</div>}
              </div>
            ))}
            {result.filings.length > 8 && (
              <p className="text-xs text-slate-400">+{result.filings.length - 8} more</p>
            )}
          </div>
        </>
      ) : (
        <p className="text-xs text-slate-600 leading-relaxed">{result?.note}</p>
      )}
    </LookupCard>
  );
}
