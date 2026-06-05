import LookupCard from './LookupCard';
import Badge from '../../../components/ui/Badge';
import type { Case } from '../../../types';
import type { AcrisResult } from './lookupTypes';

export default function AcrisLookup({ caseData }: { caseData: Case }) {
  return (
    <LookupCard<AcrisResult>
      caseData={caseData}
      lookupKey="acris"
      field="acrisResult"
      title="NYC Property Records (ACRIS)"
      description="Check if the debtor owns NYC real property — a post-judgment lien can prevent them from selling or refinancing."
      runLabel="Run ACRIS Lookup"
      render={(result) => result.error ? (
        <p className="text-xs text-muted-foreground">{result.error}</p>
      ) : (
        <>
          <div className="flex items-center gap-2 text-xs">
            <Badge tone={result.found ? 'success' : 'neutral'} size="sm">
              {result.found ? `${result.totalRecords} record(s) found` : 'No records found'}
            </Badge>
            {result.found && <span className="text-muted-foreground">· {result.searchedName}</span>}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{result.note}</p>
          {result.found && (
            <p className="text-xs text-muted-foreground">
              Verify at: <strong>a836-acris.nyc.gov</strong> → Document Search → Party Name Search
            </p>
          )}
        </>
      )}
    />
  );
}
