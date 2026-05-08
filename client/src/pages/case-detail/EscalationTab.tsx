import type { Case } from '../../types';
import PreFilingNotice from './escalation/PreFilingNotice';
import CourtFormPanel from './escalation/CourtFormPanel';
import ProcessServerPanel from './escalation/ProcessServerPanel';
import AffidavitPanel from './escalation/AffidavitPanel';
import SCRAPanel from './escalation/SCRAPanel';
import DefaultJudgmentPanel from './escalation/DefaultJudgmentPanel';
import SettlementPanel from './escalation/SettlementPanel';

export default function EscalationTab({ caseData }: { caseData: Case }) {
  const outstanding = parseFloat(caseData.amountOwed || '0') - parseFloat(caseData.amountPaid || '0');
  const courtTrack = outstanding <= 10000 ? 'commercial' : outstanding <= 50000 ? 'civil' : 'supreme';

  return (
    <div className="space-y-6">
      <PreFilingNotice caseData={caseData} />
      <CourtFormPanel caseData={caseData} />
      {(courtTrack === 'civil' || courtTrack === 'supreme') && <ProcessServerPanel caseData={caseData} />}
      <AffidavitPanel caseData={caseData} />
      <SCRAPanel caseData={caseData} />
      <DefaultJudgmentPanel caseData={caseData} />
      <SettlementPanel caseData={caseData} />
    </div>
  );
}
