import { useState } from 'react';
import { ChevronDown, CheckCircle2, CircleDashed, FileText, AlertCircle, Scale } from 'lucide-react';
import { formatCurrency, formatDate, DOC_CLASSIFICATION_LABELS } from '../../lib/utils';
import type { Case } from '../../types';
import SectionCard from '../../components/ui/SectionCard';
import Alert from '../../components/ui/Alert';
import Badge from '../../components/ui/Badge';
import { computeSOL, SOL_STATUS_TONE } from './shared/sol';
import { buildSteps, type CourtTrack, type StepItem } from './filing/filingSteps';

const COURT_INFO: Record<CourtTrack, { name: string; range: string; fee: string; rep: string; note: string }> = {
  commercial: {
    name: 'NYC Commercial Claims Court',
    range: 'Up to $10,000',
    fee: '$25 + postage',
    rep: 'No attorney required',
    note: 'Best for a clean B2B money claim by a corporation, LLC, or partnership. The court handles notice to the defendant — no process server required. Filing cap: 5 actions per month per claimant.',
  },
  civil: {
    name: 'NYC Civil Court — General Civil Part',
    range: '$10,001–$50,000',
    fee: '~$45',
    rep: 'Attorney recommended',
    note: 'Standard civil case structure. You file a summons and complaint, serve via process server, and proceed through the formal civil track.',
  },
  supreme: {
    name: 'NY Supreme Court',
    range: 'Above $50,000',
    fee: '$210 (index number)',
    rep: 'Attorney strongly recommended',
    note: 'Full formal litigation. File in the county where the defendant does business. Discovery applies. E-filing is mandatory for represented parties in most NYC counties.',
  },
};

function ExpandableItem({ label, children, num }: { label: string; children: React.ReactNode; num: number }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-50 transition-colors"
      >
        <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-bold shrink-0">
          {num}
        </span>
        <span className="text-sm text-slate-700 flex-1 leading-snug font-medium">{label}</span>
        <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4 pt-2 border-t border-slate-100 space-y-2">{children}</div>}
    </li>
  );
}

export default function FilingGuideTab({ caseData }: { caseData: Case }) {
  const outstanding = parseFloat(caseData.amountOwed || '0') - parseFloat(caseData.amountPaid || '0');
  const track: CourtTrack = outstanding <= 10000 ? 'commercial' : outstanding <= 50000 ? 'civil' : 'supreme';
  const info = COURT_INFO[track];
  const sol = computeSOL(caseData.paymentDueDate);
  const steps: StepItem[] = buildSteps(track, !!caseData.demandLetter);

  const checklist = [
    { label: 'Exact legal name of your company (as registered)', done: !!(caseData.claimantBusiness || caseData.claimantName) },
    { label: 'Exact legal name and address of the defendant', done: !!(caseData.debtorBusiness || caseData.debtorName) },
    { label: 'Contract, proposal, or statement of work', done: caseData.documents.some(d => d.classification === 'contract') },
    { label: 'Invoice(s) with payment terms and due date', done: caseData.documents.some(d => d.classification === 'invoice') },
    { label: 'Proof of work performed / delivered', done: caseData.documents.some(d => d.classification === 'proof_of_work') },
    { label: 'Emails or messages showing the deal or non-payment', done: caseData.documents.some(d => d.classification === 'communication') },
    { label: 'Demand letter sent (required for Commercial Claims)', done: !!caseData.demandLetter },
    { label: 'One-page chronology of events', done: !!(caseData.caseTimeline && (caseData.caseTimeline as unknown[]).length > 0) },
  ];

  const demandSentAction = caseData.actions.find(a =>
    a.type === 'EMAIL_SENT' || a.type === 'CERTIFIED_MAIL_SENT' || a.type === 'DEMAND_LETTER_GENERATED'
  );
  const svcAction = caseData.actions.find(a => a.type === 'SERVICE_INITIATED');
  const svcDate = svcAction ? new Date(svcAction.createdAt) : null;
  const personalAnswerDue = svcDate ? new Date(new Date(svcDate).setDate(svcDate.getDate() + 20)) : null;
  const altAnswerDue = svcDate ? new Date(new Date(svcDate).setDate(svcDate.getDate() + 30)) : null;
  const defaultMotionDate = altAnswerDue ? new Date(new Date(altAnswerDue).setDate(altAnswerDue.getDate() + 1)) : null;
  const fmt = (d: Date | null) => d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  const today = new Date();
  const daysLeft = (d: Date | null) => d ? Math.ceil((d.getTime() - today.getTime()) / 86400000) : null;

  const deadlines = [
    { label: 'Demand letter sent', value: demandSentAction ? formatDate(demandSentAction.createdAt) : null, days: null as number | null, note: 'Required for Commercial Claims (10+ days before filing)' },
    { label: 'Claim filed', value: null, days: null, note: 'Record date you file at the courthouse' },
    { label: 'Service completed', value: svcDate ? fmt(svcDate) : null, days: null, note: 'Must occur within 120 days of filing' },
    { label: 'Affidavit of service filed', value: null, days: null, note: 'File promptly after service — do not wait' },
    { label: 'Answer due (personal service)', value: fmt(personalAnswerDue), days: daysLeft(personalAnswerDue), note: '20 days from personal service (CPLR)' },
    { label: 'Answer due (other service)', value: fmt(altAnswerDue), days: daysLeft(altAnswerDue), note: '30 days from completed service (CPLR)' },
    { label: 'Default motion eligible', value: fmt(defaultMotionDate), days: daysLeft(defaultMotionDate), note: 'Day after answer deadline passes' },
    { label: 'RJI deadline (Supreme Court)', value: null, days: null, note: '60 days from first filing (Supreme Court only)' },
  ];

  return (
    <div className="space-y-6">
      {/* Court routing */}
      <SectionCard padding="lg">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Scale className="w-5 h-5 text-blue-600" />
              <div className="text-lg font-bold text-slate-900">{info.name}</div>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">{info.note}</p>
          </div>
          <Badge tone="info" size="lg">{formatCurrency(outstanding)} outstanding</Badge>
        </div>
        <div className="flex flex-wrap gap-6 mt-4 text-sm border-t border-slate-100 pt-4">
          <div><span className="text-slate-500">Filing Fee:</span> <span className="font-semibold text-slate-800">{info.fee}</span></div>
          <div><span className="text-slate-500">Representation:</span> <span className="font-semibold text-slate-800">{info.rep}</span></div>
          <div><span className="text-slate-500">Claim Range:</span> <span className="font-semibold text-slate-800">{info.range}</span></div>
        </div>
        {sol.status !== 'unknown' && (
          <div className="mt-3">
            <Alert tone={SOL_STATUS_TONE[sol.status]} title="Statute of Limitations (CPLR §213)">
              {sol.label}
            </Alert>
          </div>
        )}
      </SectionCard>

      {/* Court thresholds */}
      <SectionCard title="NYC Court Thresholds" collapsible defaultOpen={false}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {([
            { key: 'commercial' as const, label: 'Commercial Claims', range: '≤ $10,000', fee: '$25 + postage', note: 'Corp/LLC/partnership, no attorney' },
            { key: 'civil' as const, label: 'Civil Court', range: '$10,001–$50,000', fee: '~$45', note: 'Summons + complaint, process server' },
            { key: 'supreme' as const, label: 'Supreme Court', range: '> $50,000', fee: '$210+', note: 'Full litigation, attorney recommended' },
          ]).map((c) => (
            <div key={c.key} className={`p-4 rounded-lg border ${track === c.key ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white'}`}>
              <div className="text-sm font-semibold text-slate-800">{c.label}</div>
              <div className="text-xs text-slate-500 mt-1">{c.range}</div>
              <div className="text-xs text-slate-400 mt-0.5">Fee: {c.fee}</div>
              <div className="text-xs text-slate-400 mt-1 leading-tight">{c.note}</div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Pre-filing checklist */}
      <SectionCard title="Pre-Filing Checklist" collapsible defaultOpen>
        <ul className="space-y-2">
          {checklist.map(({ label, done }, i) => (
            <li key={i} className={`flex items-start gap-2.5 text-sm ${done ? 'text-slate-700' : 'text-slate-400'}`}>
              {done ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                    : <CircleDashed className="w-4 h-4 text-slate-300 mt-0.5 shrink-0" />}
              <span>{label}</span>
            </li>
          ))}
        </ul>
        {caseData.documents.length > 0 && (
          <>
            <div className="divider my-4" />
            <div className="kbd-label mb-2">Documents in this case</div>
            <div className="flex flex-wrap gap-2">
              {caseData.documents.map((doc) => (
                <Badge key={doc.id} tone="neutral" size="sm" icon={<FileText className="w-3 h-3" />}>
                  {doc.originalName}
                  {doc.classification && <span className="opacity-60"> · {DOC_CLASSIFICATION_LABELS[doc.classification] ?? doc.classification}</span>}
                </Badge>
              ))}
            </div>
          </>
        )}
      </SectionCard>

      {/* Filing steps */}
      <SectionCard title={`Filing Steps — ${info.name}`} collapsible defaultOpen>
        <ol className="space-y-2">
          {steps.map((step, i) => (
            <ExpandableItem key={i} num={i + 1} label={step.label}>
              {step.body}
            </ExpandableItem>
          ))}
        </ol>
      </SectionCard>

      {/* How to handle service */}
      <SectionCard title="How to Handle Service Properly" collapsible defaultOpen={false}>
        <ul className="space-y-2">
          {[
            'Use the defendant\'s exact legal name — service on the wrong entity name can void service.',
            'Use a licensed process server (required for Civil Court and Supreme Court).',
            'Get the Affidavit of Service right: it must be notarized and include the date, time, location, and method of service.',
            'File the affidavit with the court promptly — do not sit on it.',
            'Calendar the answer deadline the same day service is completed.',
            'Service mistakes are the easiest way to lose or delay a case. Do not improvise.',
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
              <span className="text-slate-300 font-bold mt-0.5">—</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </SectionCard>

      {/* Deadline tracker */}
      <SectionCard title="Case Deadline Tracker" collapsible defaultOpen>
        <div className="space-y-2">
          {deadlines.map(({ label, value, days, note }, i) => {
            const isPast = days != null && days < 0;
            const isUrgent = days != null && days >= 0 && days <= 14;
            const hasDays = days != null;
            const rowCls = isPast
              ? 'bg-red-50 border-red-200'
              : value ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-100';
            const textCls = isPast ? 'text-red-700' : value ? 'text-emerald-800' : 'text-slate-600';
            const valueCls = isPast ? 'text-red-700' : isUrgent ? 'text-amber-700' : 'text-slate-700';
            return (
              <div key={i} className={`flex items-start gap-3 p-2.5 rounded-lg border ${rowCls}`}>
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${isPast ? 'bg-red-400' : value ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-xs font-medium ${textCls}`}>{label}</span>
                    {value && (
                      <span className={`text-xs font-semibold ml-auto shrink-0 ${valueCls}`}>
                        {value}{hasDays && days! >= 0 ? ` (${days}d)` : isPast ? ' (PASSED)' : ''}
                      </span>
                    )}
                    {!value && <span className="text-xs text-slate-300 ml-auto shrink-0">—</span>}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">{note}</div>
                </div>
              </div>
            );
          })}
        </div>
        {!svcAction && (
          <p className="text-xs text-slate-400 mt-3 pt-3 border-t border-slate-100">
            Log "Service Initiated" in the Escalation tab to calculate answer and default deadlines automatically.
          </p>
        )}
      </SectionCard>

      {/* Common mistakes */}
      <SectionCard title="Common Mistakes to Avoid" collapsible defaultOpen={false}>
        <ul className="space-y-2">
          {[
            'Suing the wrong entity name — always verify via NYS entity records.',
            'Filing in the wrong court for your amount.',
            'Skipping the pre-suit demand letter for Commercial Claims (it is a legal precondition).',
            'Missing the 120-day service window after filing.',
            'Failing to file proof of service with the court.',
            'Not calendaring the defendant\'s answer deadline.',
            'Serving the wrong person — for business entities, serve an officer, director, or registered agent.',
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </SectionCard>

      {/* Enforcement */}
      <SectionCard title="Enforcing a Judgment" collapsible defaultOpen={false}>
        <p className="text-sm text-slate-600 mb-3">
          Winning in court gives you a judgment — a legal right to collect. The court does not collect for you. Three main enforcement tools:
        </p>
        <div className="space-y-2">
          {[
            { title: 'Bank Levy', body: 'Instruct a city marshal or sheriff to freeze and seize funds from the debtor\'s bank account. You may need to identify the bank through post-judgment disclosure proceedings.' },
            { title: 'Property Lien', body: 'File a lien against real property the debtor owns in New York. They cannot sell or refinance the property without satisfying your judgment first.' },
            { title: 'Income Execution (Wage Garnishment)', body: 'If the debtor is an individual with employment income, you can garnish up to 10% of gross wages in NY. Does not apply to business entity defendants — use bank levy instead.' },
          ].map(({ title, body }) => (
            <div key={title} className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-sm font-semibold text-slate-800 mb-1">{title}</div>
              <p className="text-xs text-slate-600 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* NYC Marshals */}
      <SectionCard title="NYC City Marshals — Judgment Enforcement" collapsible defaultOpen={false}>
        <p className="text-xs text-slate-500 mb-4 leading-relaxed">
          Once you have a judgment, a NYC City Marshal can levy bank accounts, seize business property, and execute income executions.
          Marshals are private officers appointed by the Mayor of New York City — you hire them directly, without court involvement.
        </p>
        <div className="space-y-3">
          {[
            { title: 'Fee structure', body: 'Marshals typically charge 5% of the amount collected. You advance filing and levy costs ($50–$200), recoverable from the debtor.' },
            { title: 'What they can do', body: 'Bank levy, personal property execution, income execution / wage garnishment (individuals only — not LLCs or corps).' },
            { title: 'How to find one', body: 'Search the NYC Department of Investigation marshal directory at nyc.gov. Each marshal has a borough focus.' },
            { title: 'What you\'ll need to provide', body: 'A certified copy of your judgment, the debtor\'s last known address, and — for a bank levy — the name and branch of the debtor\'s bank.' },
          ].map(({ title, body }) => (
            <div key={title} className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-xs font-semibold text-slate-700 mb-1">{title}</div>
              <p className="text-xs text-slate-500 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <Alert tone="info">
            Official directory: visit <strong>nyc.gov/site/doi/enforcement/city-marshals.page</strong> for the current list of active marshals.
          </Alert>
        </div>
      </SectionCard>

      <Alert tone="warning">
        This is general procedural information, not legal advice. Court rules, fees, and procedures change. Consult a NY-licensed attorney before filing, especially for claims above $10,000.
      </Alert>
    </div>
  );
}
