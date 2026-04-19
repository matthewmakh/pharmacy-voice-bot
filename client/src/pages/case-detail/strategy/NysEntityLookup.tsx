import { useState } from 'react';
import { lookupNYSEntity } from '../../../lib/api';
import LookupCard from './LookupCard';
import Badge, { type Tone } from '../../../components/ui/Badge';
import type { NysEntityResult } from './lookupTypes';

export default function NysEntityLookup({ caseId }: { caseId: string }) {
  const [result, setResult] = useState<NysEntityResult | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      setResult(await lookupNYSEntity(caseId));
    } catch {
      setResult({ found: false, totalRecords: 0, entities: [], searchedName: '', note: '', error: 'Lookup failed' });
    } finally {
      setLoading(false);
    }
  };

  const statusTone = (s: string): Tone => {
    if (s.toLowerCase() === 'active') return 'success';
    if (/dissolved|inactive|cancelled|revoked/i.test(s)) return 'danger';
    return 'neutral';
  };

  return (
    <LookupCard
      title="NYS Entity Status"
      description="Look up debtor entity status, registered agent, and formation date in the NYS Department of State database. Registered agent address is legally valid for service of process."
      loading={loading}
      hasResult={!!result}
      onRun={run}
      runLabel="Search NYS DOS"
    >
      {result?.error ? (
        <p className="text-xs text-slate-500">{result.error}</p>
      ) : result?.found && result.entities.length > 0 ? (
        <>
          {result.entities.slice(0, 3).map((e, i) => (
            <div key={i} className="p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-slate-800">{e.entityName}</span>
                <Badge tone={statusTone(e.status)} size="sm">{e.status}</Badge>
                {e.entityType && <span className="text-slate-400">{e.entityType}</span>}
                {e.dosId && <span className="text-slate-400 font-mono">DOS #{e.dosId}</span>}
              </div>
              {e.registeredAgent && (
                <div className="text-slate-600">
                  <span className="font-medium">Registered Agent:</span> {e.registeredAgent}
                  {e.registeredAgentAddress && <span className="text-slate-500"> — {e.registeredAgentAddress}</span>}
                </div>
              )}
              {e.dosProcessAddress && (
                <div className="text-slate-500"><span className="font-medium text-slate-600">DOS Process:</span> {e.dosProcessAddress}</div>
              )}
              {e.contacts?.filter(c => c.role !== 'Registered Agent').map((c, ci) => (
                <div key={ci} className="text-slate-500">
                  <span className="font-medium text-slate-600">{c.role}:</span> {c.name}{c.address ? ` — ${c.address}` : ''}
                </div>
              ))}
              {e.formationDate && (
                <div className="text-slate-400">Formed: {e.formationDate}{e.county ? ` · ${e.county} County` : ''}</div>
              )}
            </div>
          ))}
          <p className="text-xs text-slate-600 leading-relaxed">{result.note}</p>
          <p className="text-xs text-slate-400">Verify at: <strong>apps.dos.ny.gov/publicInquiry/</strong></p>
        </>
      ) : (
        <p className="text-xs text-slate-600 leading-relaxed">{result?.note}</p>
      )}
    </LookupCard>
  );
}
