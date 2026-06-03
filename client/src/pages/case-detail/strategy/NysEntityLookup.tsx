import LookupCard from './LookupCard';
import Badge, { type Tone } from '../../../components/ui/Badge';
import type { Case } from '../../../types';
import type { NysEntityResult } from './lookupTypes';

const statusTone = (s: string): Tone => {
  if (s.toLowerCase() === 'active') return 'success';
  if (/dissolved|inactive|cancelled|revoked/i.test(s)) return 'danger';
  return 'neutral';
};

export default function NysEntityLookup({ caseData }: { caseData: Case }) {
  return (
    <LookupCard<NysEntityResult>
      caseData={caseData}
      lookupKey="entity"
      field="entityResult"
      title="NYS Entity Status"
      description="Look up debtor entity status, registered agent, and formation date in the NYS Department of State database. Registered agent address is legally valid for service of process."
      runLabel="Search NYS DOS"
      render={(result) => result.error ? (
        <p className="text-xs text-muted-foreground">{result.error}</p>
      ) : result.found && result.entities.length > 0 ? (
        <>
          {result.entities.slice(0, 3).map((e, i) => (
            <div key={i} className="p-3 rounded-lg border border-border bg-muted text-xs space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-foreground">{e.entityName}</span>
                <Badge tone={statusTone(e.status)} size="sm">{e.status}</Badge>
                {e.entityType && <span className="text-muted-foreground">{e.entityType}</span>}
                {e.dosId && <span className="text-muted-foreground font-mono">DOS #{e.dosId}</span>}
              </div>
              {e.registeredAgent && (
                <div className="text-muted-foreground">
                  <span className="font-medium">Registered Agent:</span> {e.registeredAgent}
                  {e.registeredAgentAddress && <span className="text-muted-foreground"> — {e.registeredAgentAddress}</span>}
                </div>
              )}
              {e.dosProcessAddress && (
                <div className="text-muted-foreground"><span className="font-medium text-muted-foreground">DOS Process:</span> {e.dosProcessAddress}</div>
              )}
              {e.contacts?.filter(c => c.role !== 'Registered Agent').map((c, ci) => (
                <div key={ci} className="text-muted-foreground">
                  <span className="font-medium text-muted-foreground">{c.role}:</span> {c.name}{c.address ? ` — ${c.address}` : ''}
                </div>
              ))}
              {e.formationDate && (
                <div className="text-muted-foreground">Formed: {e.formationDate}{e.county ? ` · ${e.county} County` : ''}</div>
              )}
            </div>
          ))}
          <p className="text-xs text-muted-foreground leading-relaxed">{result.note}</p>
          <p className="text-xs text-muted-foreground">Verify at: <strong>apps.dos.ny.gov/publicInquiry/</strong></p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground leading-relaxed">{result.note}</p>
      )}
    />
  );
}
