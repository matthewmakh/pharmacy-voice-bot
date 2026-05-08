import React from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Check, X, Loader2, AlertCircle, ExternalLink, Briefcase, Building2, ChevronDown, ChevronRight } from 'lucide-react';
import {
  getAttorneyHandoffCase,
  acceptAttorneyHandoff,
  declineAttorneyHandoff,
  reportAttorneyOutcome,
  getAttorneyDocUrl,
} from '../lib/api';

interface HandoffCaseView {
  handoff: {
    status: string | null;
    initiatedAt: string;
    acceptedAt: string | null;
    resolvedAt: string | null;
    notes: string | null;
    outcome: string | null;
    settlementCents: number | null;
    partner: { name: string; firmName: string | null; referralFeePercent: string } | null;
  };
  summary: Record<string, unknown>;
  preTrial: Record<string, boolean>;
  investigation: Record<string, unknown>;
  timeline: Array<{ type: string; label: string | null; notes: string | null; createdAt: string }>;
  filingStatus: Record<string, unknown>;
  collected: { amountCollectedCents: number | null; payoutCompletedAt: string | null };
}

const PRE_TRIAL_DOCS: Array<{ field: string; kind: string; label: string }> = [
  { field: 'demandLetter', kind: 'demand-letter', label: 'Demand Letter' },
  { field: 'finalNotice', kind: 'final-notice', label: 'Pre-Filing Notice' },
  { field: 'courtForm', kind: 'court-form', label: 'Court Form / Summons & Complaint' },
  { field: 'affidavitOfService', kind: 'affidavit-of-service', label: 'Affidavit of Service' },
  { field: 'scraAffidavit', kind: 'scra-affidavit', label: 'SCRA Non-Military Affidavit' },
  { field: 'defaultJudgment', kind: 'default-judgment', label: 'Default Judgment Motion' },
  { field: 'settlement', kind: 'settlement', label: 'Stipulation of Settlement' },
  { field: 'paymentPlan', kind: 'payment-plan', label: 'Payment Plan Agreement' },
  { field: 'informationSubpoena', kind: 'information-subpoena', label: 'Information Subpoena (CPLR §5224)' },
  { field: 'restrainingNotice', kind: 'restraining-notice', label: 'Restraining Notice (§5222)' },
  { field: 'propertyExecution', kind: 'property-execution', label: 'Property Execution (§5230)' },
  { field: 'incomeExecution', kind: 'income-execution', label: 'Income Execution (§5231)' },
  { field: 'marshalRequest', kind: 'marshal-request', label: 'Marshal Request packet' },
];

export default function AttorneyPortal() {
  const { token = '' } = useParams<{ token: string }>();
  const queryClient = useQueryClient();
  const [decisionMode, setDecisionMode] = React.useState<'idle' | 'declining' | 'reporting'>('idle');
  const [declineReason, setDeclineReason] = React.useState('');
  const [reportStatus, setReportStatus] = React.useState<'in-progress' | 'resolved' | 'lost'>('in-progress');
  const [settlementAmount, setSettlementAmount] = React.useState('');
  const [reportNotes, setReportNotes] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['attorney-handoff', token],
    queryFn: () => getAttorneyHandoffCase(token) as Promise<HandoffCaseView>,
    enabled: !!token,
    retry: false,
  });

  const acceptMutation = useMutation({
    mutationFn: () => acceptAttorneyHandoff(token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attorney-handoff', token] }),
    onError: (err: unknown) => setError(extractError(err)),
  });
  const declineMutation = useMutation({
    mutationFn: () => declineAttorneyHandoff(token, declineReason || undefined),
    onSuccess: () => {
      setDecisionMode('idle');
      queryClient.invalidateQueries({ queryKey: ['attorney-handoff', token] });
    },
    onError: (err: unknown) => setError(extractError(err)),
  });
  const reportMutation = useMutation({
    mutationFn: () =>
      reportAttorneyOutcome(
        token,
        reportStatus,
        settlementAmount ? Number(settlementAmount) : undefined,
        reportNotes || undefined,
      ),
    onSuccess: () => {
      setDecisionMode('idle');
      queryClient.invalidateQueries({ queryKey: ['attorney-handoff', token] });
    },
    onError: (err: unknown) => setError(extractError(err)),
  });

  if (isLoading) {
    return <Centered><Loader2 className="w-5 h-5 animate-spin" /></Centered>;
  }
  if (isError || !data) {
    return (
      <Centered>
        <AlertCircle className="w-8 h-8 text-amber-500" />
        <h2 className="text-lg font-semibold mt-2">Link not found</h2>
        <p className="text-sm text-slate-500 mt-1">This referral link is invalid or expired.</p>
      </Centered>
    );
  }

  const status = data.handoff.status;
  const summary = data.summary as Record<string, string | number | boolean | null>;
  const amountStr = summary.amountOwed
    ? `$${Number(summary.amountOwed).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
    : '—';

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <header className="mb-6">
          <p className="text-xs uppercase tracking-wider text-slate-400 mb-1">Attorney case referral</p>
          <h1 className="text-2xl font-semibold text-slate-900">
            {summary.claimant} v. {summary.debtor}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Amount: <strong className="text-slate-800">{amountStr}</strong>
            {data.handoff.partner && (
              <> · Referral fee: <strong>{data.handoff.partner.referralFeePercent}%</strong> of contingency</>
            )}
          </p>
        </header>

        {/* Decision actions */}
        {status === 'pending' && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Briefcase className="w-5 h-5 text-amber-700" />
              <div className="text-base font-semibold text-amber-900">Action required: accept or decline</div>
            </div>
            {decisionMode === 'idle' && (
              <div className="flex items-center gap-2">
                <button onClick={() => acceptMutation.mutate()} disabled={acceptMutation.isPending} className="btn-primary">
                  {acceptMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Accepting…</> : <><Check className="w-4 h-4" /> Accept case</>}
                </button>
                <button onClick={() => setDecisionMode('declining')} className="btn-secondary">
                  <X className="w-4 h-4" /> Decline
                </button>
              </div>
            )}
            {decisionMode === 'declining' && (
              <div className="space-y-2">
                <label className="label">Reason (optional, shared with claimant)</label>
                <textarea rows={3} value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} className="input" />
                <div className="flex items-center gap-2">
                  <button onClick={() => declineMutation.mutate()} disabled={declineMutation.isPending} className="btn-danger">
                    {declineMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Declining…</> : 'Confirm decline'}
                  </button>
                  <button onClick={() => setDecisionMode('idle')} className="btn-ghost">Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Status banner for non-pending */}
        {status && status !== 'pending' && (
          <StatusBanner status={status} handoff={data.handoff} />
        )}

        {/* Update status (after accepted) */}
        {(status === 'accepted' || status === 'in-progress') && decisionMode === 'idle' && (
          <button onClick={() => setDecisionMode('reporting')} className="btn-secondary mb-6">
            Update case status →
          </button>
        )}
        {decisionMode === 'reporting' && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6 space-y-3">
            <div className="text-base font-semibold text-slate-900">Report outcome</div>
            <div>
              <label className="label">Status</label>
              <select value={reportStatus} onChange={(e) => setReportStatus(e.target.value as typeof reportStatus)} className="input">
                <option value="in-progress">In progress</option>
                <option value="resolved">Resolved (settled or judgment satisfied)</option>
                <option value="lost">Lost / closed without recovery</option>
              </select>
            </div>
            {reportStatus === 'resolved' && (
              <div>
                <label className="label">Total settlement amount (USD)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={settlementAmount}
                  onChange={(e) => setSettlementAmount(e.target.value)}
                  placeholder="e.g. 8500.00"
                  className="input"
                />
                <p className="text-xs text-slate-500 mt-1">Used to compute the Reclaim referral fee.</p>
              </div>
            )}
            <div>
              <label className="label">Notes (optional)</label>
              <textarea rows={3} value={reportNotes} onChange={(e) => setReportNotes(e.target.value)} className="input" />
            </div>
            {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
            <div className="flex items-center gap-2">
              <button onClick={() => reportMutation.mutate()} disabled={reportMutation.isPending} className="btn-primary">
                {reportMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</> : 'Submit'}
              </button>
              <button onClick={() => setDecisionMode('idle')} className="btn-ghost">Cancel</button>
            </div>
          </div>
        )}

        {error && status === 'pending' && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2 mb-4">{error}</div>
        )}

        {/* Notes from claimant */}
        {data.handoff.notes && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
            <div className="text-sm font-semibold text-slate-700 mb-2">Notes from claimant</div>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{data.handoff.notes}</p>
          </div>
        )}

        {/* Case summary */}
        <Section title="Case summary" icon={<Building2 className="w-4 h-4" />}>
          <SummaryGrid summary={summary} filingStatus={data.filingStatus} collected={data.collected} />
        </Section>

        {/* Documents */}
        <Section title="Documents" icon={<FileText className="w-4 h-4" />}>
          <ul className="divide-y divide-slate-100">
            {PRE_TRIAL_DOCS.map((d) => {
              const has = data.preTrial[d.field];
              return (
                <li key={d.kind} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2 text-sm">
                    {has ? (
                      <Check className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <span className="w-4 h-4 inline-block" />
                    )}
                    <span className={has ? 'text-slate-700' : 'text-slate-400'}>{d.label}</span>
                  </div>
                  {has && (
                    <a
                      href={getAttorneyDocUrl(token, d.kind)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline text-xs inline-flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" /> Open
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>

        {/* Timeline */}
        <Section title="Case timeline" icon={null} defaultOpen={false}>
          <ol className="space-y-2 text-sm">
            {data.timeline.map((a, i) => (
              <li key={i} className="text-slate-600">
                <span className="text-slate-400 text-xs mr-2">{new Date(a.createdAt).toLocaleDateString()}</span>
                {a.label || a.type}
              </li>
            ))}
          </ol>
        </Section>

        {/* Investigation */}
        <Section title="Debtor investigation" icon={null} defaultOpen={false}>
          <pre className="text-xs text-slate-600 bg-slate-50 rounded p-3 overflow-x-auto">
{JSON.stringify(data.investigation, null, 2)}
          </pre>
        </Section>

        <p className="text-xs text-slate-400 text-center mt-8">
          Powered by Reclaim · Secure attorney portal · Case ID hidden for confidentiality
        </p>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 gap-2 text-slate-500">
      {children}
    </div>
  );
}

function Section({
  title,
  icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-4 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-5 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
        {icon}
        <span className="text-sm font-semibold text-slate-700">{title}</span>
      </button>
      {open && <div className="px-5 pb-5 pt-0 border-t border-slate-100">{children}</div>}
    </div>
  );
}

function StatusBanner({ status, handoff }: { status: string; handoff: HandoffCaseView['handoff'] }) {
  const map: Record<string, { color: string; label: string }> = {
    accepted: { color: 'bg-blue-50 border-blue-200 text-blue-900', label: 'You accepted this case' },
    'in-progress': { color: 'bg-blue-50 border-blue-200 text-blue-900', label: 'Case in progress' },
    declined: { color: 'bg-red-50 border-red-200 text-red-900', label: 'You declined this case' },
    resolved: { color: 'bg-emerald-50 border-emerald-200 text-emerald-900', label: 'Case resolved' },
    lost: { color: 'bg-slate-100 border-slate-300 text-slate-700', label: 'Case closed without recovery' },
  };
  const m = map[status] || map.accepted;
  return (
    <div className={`border rounded-xl p-5 mb-6 ${m.color}`}>
      <div className="font-semibold">{m.label}</div>
      {handoff.settlementCents !== null && handoff.settlementCents !== undefined && (
        <div className="text-sm mt-1">
          Settlement amount: ${(handoff.settlementCents / 100).toLocaleString()}
        </div>
      )}
      {handoff.outcome && (
        <div className="text-sm mt-2 whitespace-pre-wrap">{handoff.outcome}</div>
      )}
    </div>
  );
}

function SummaryGrid({
  summary,
  filingStatus,
  collected,
}: {
  summary: Record<string, string | number | boolean | null>;
  filingStatus: Record<string, unknown>;
  collected: { amountCollectedCents: number | null; payoutCompletedAt: string | null };
}) {
  const Row = ({ label, value }: { label: string; value: React.ReactNode }) =>
    value !== null && value !== undefined && value !== '' ? (
      <div className="flex justify-between gap-4 py-1.5 text-sm">
        <span className="text-slate-500">{label}</span>
        <span className="text-slate-800 font-medium text-right">{value}</span>
      </div>
    ) : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
      <div>
        <Row label="Claimant" value={summary.claimant as string} />
        <Row label="Claimant email" value={summary.claimantEmail as string} />
        <Row label="Defendant" value={summary.debtor as string} />
        <Row label="Defendant email" value={summary.debtorEmail as string} />
        <Row label="Defendant address" value={summary.debtorAddress as string} />
        <Row label="Defendant phone" value={summary.debtorPhone as string} />
        <Row label="Defendant entity type" value={summary.debtorEntityType as string} />
      </div>
      <div>
        <Row label="Amount owed" value={summary.amountOwed ? `$${Number(summary.amountOwed).toLocaleString()}` : null} />
        <Row label="Amount paid" value={summary.amountPaid ? `$${Number(summary.amountPaid).toLocaleString()}` : null} />
        <Row label="Invoice #" value={summary.invoiceNumber as string} />
        <Row label="Invoice date" value={summary.invoiceDate ? new Date(summary.invoiceDate as string).toLocaleDateString() : null} />
        <Row label="Agreement date" value={summary.agreementDate ? new Date(summary.agreementDate as string).toLocaleDateString() : null} />
        <Row label="Has written contract?" value={summary.hasWrittenContract ? 'Yes' : 'No'} />
        <Row label="Service description" value={summary.serviceDescription as string} />
        <Row label="Default judgment filed" value={filingStatus.defaultJudgmentFiledAt ? new Date(filingStatus.defaultJudgmentFiledAt as string).toLocaleDateString() : null} />
        <Row label="Index #" value={filingStatus.defaultJudgmentIndexNumber as string} />
        <Row label="Already collected" value={collected.amountCollectedCents ? `$${(collected.amountCollectedCents / 100).toLocaleString()}` : null} />
      </div>
      {summary.notes && (
        <div className="md:col-span-2 mt-2 pt-2 border-t border-slate-100">
          <div className="text-xs text-slate-500 mb-1">Claimant notes</div>
          <div className="text-sm text-slate-700 whitespace-pre-wrap">{summary.notes as string}</div>
        </div>
      )}
    </div>
  );
}

function extractError(err: unknown): string {
  return (
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error
    || (err as Error)?.message
    || 'Something went wrong'
  );
}
