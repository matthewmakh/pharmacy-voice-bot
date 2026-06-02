import LookupCard from './LookupCard';
import Badge from '../../../components/ui/Badge';
import type { Case } from '../../../types';
import type { CourtHistoryResult } from './lookupTypes';

export default function CourtHistoryLookup({ caseData }: { caseData: Case }) {
  return (
    <LookupCard<CourtHistoryResult>
      caseData={caseData}
      lookupKey="courts"
      field="courtHistory"
      title="NYC Civil Court History"
      description="Search NYC Civil Court records for prior cases against this debtor — prior judgments, defaults, or serial non-payment patterns change your strategy."
      runLabel="Search Court Records"
      render={(result) => result.error ? (
        <div className="text-xs text-slate-500">
          <p>{result.error}</p>
          {result.scraperNote && <p className="mt-1 text-slate-400 italic">{result.scraperNote}</p>}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Badge tone={result.found ? (result.asDefendant > 2 ? 'warning' : 'neutral') : 'neutral'} size="sm">
              {result.found ? `${result.totalCases} case(s) — ${result.asDefendant} as defendant` : 'No prior cases found'}
            </Badge>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">{result.note}</p>
          {result.found && result.cases.length > 0 && (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {result.cases.slice(0, 6).map((c, i) => (
                <div key={i} className="flex gap-2 text-xs p-1.5 bg-slate-50 rounded border border-slate-100">
                  <span className="text-slate-400 shrink-0 font-mono">{c.caseIndex}</span>
                  <span className="text-slate-600 truncate">{c.plaintiff} v. {c.defendant}</span>
                  <span className="text-slate-400 shrink-0">{c.status}</span>
                </div>
              ))}
              {result.cases.length > 6 && (
                <p className="text-xs text-slate-400">+{result.cases.length - 6} more — verify at iapps.courts.state.ny.us</p>
              )}
            </div>
          )}
          <p className="text-xs text-slate-400">Verify at: <strong>iapps.courts.state.ny.us/webcivil/FCASMain</strong></p>
        </>
      )}
    />
  );
}
