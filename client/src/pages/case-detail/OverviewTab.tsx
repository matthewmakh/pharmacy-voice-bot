import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, CheckCircle2, CircleDashed } from 'lucide-react';
import { updateCase } from '../../lib/api';
import { formatCurrency, formatDate, STRENGTH_TONES } from '../../lib/utils';
import type { Case, MissingInfoItem } from '../../types';
import SectionCard from '../../components/ui/SectionCard';
import Alert from '../../components/ui/Alert';
import Badge, { type Tone } from '../../components/ui/Badge';
import { computeSOL, SOL_STATUS_TONE } from './shared/sol';

const IMPACT_TONE: Record<'high' | 'medium' | 'low', Tone> = {
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
};

export default function OverviewTab({ caseData }: { caseData: Case }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => makeForm(caseData));

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateCase(caseData.id, data as Parameters<typeof updateCase>[1]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case', caseData.id] });
      setEditing(false);
    },
  });

  const outstanding = parseFloat(caseData.amountOwed || '0') - parseFloat(caseData.amountPaid || '0');
  const evidenceSummary = caseData.evidenceSummary as Record<string, unknown> | null;
  const missingInfo = caseData.missingInfo || [];

  const handleSave = () => {
    const payload: Record<string, unknown> = { ...form };
    if (form.amountOwed) payload.amountOwed = parseFloat(form.amountOwed);
    if (form.amountPaid) payload.amountPaid = parseFloat(form.amountPaid);
    ['agreementDate', 'invoiceDate', 'paymentDueDate', 'serviceStartDate', 'serviceEndDate'].forEach((k) => {
      if (!payload[k]) payload[k] = null;
    });
    updateMutation.mutate(payload);
  };

  const handleStartEdit = () => {
    setForm(makeForm(caseData));
    setEditing(true);
  };

  const field = (label: string, key: string, type = 'text') => (
    <div key={key}>
      <label className="field-label block mb-1">{label}</label>
      {type === 'textarea' ? (
        <textarea
          className="input"
          rows={3}
          value={(form as Record<string, unknown>)[key] as string}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        />
      ) : type === 'checkbox' ? (
        <input
          type="checkbox"
          className="rounded border-slate-300"
          checked={(form as Record<string, unknown>)[key] as boolean}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))}
        />
      ) : (
        <input
          type={type}
          className="input"
          value={(form as Record<string, unknown>)[key] as string}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        />
      )}
    </div>
  );

  const sol = computeSOL(caseData.paymentDueDate);

  return (
    <div className="space-y-6">
      {/* Key Numbers */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-5">
          <div className="field-label mb-1">Amount Owed</div>
          <div className="text-2xl font-bold text-slate-900">{formatCurrency(caseData.amountOwed)}</div>
        </div>
        <div className="card p-5">
          <div className="field-label mb-1">Amount Paid</div>
          <div className="text-2xl font-bold text-slate-900">{formatCurrency(caseData.amountPaid || 0)}</div>
        </div>
        <div className="card p-5 bg-blue-50 border-blue-200">
          <div className="text-xs font-medium text-blue-700 mb-1">Outstanding Balance</div>
          <div className="text-2xl font-bold text-blue-900">{formatCurrency(outstanding)}</div>
        </div>
      </div>

      {/* Pre-judgment interest */}
      {outstanding > 0 && caseData.paymentDueDate && (() => {
        const breachDate = new Date(caseData.paymentDueDate!);
        const today = new Date();
        const daysElapsed = Math.max(0, Math.floor((today.getTime() - breachDate.getTime()) / 86400000));
        if (daysElapsed < 1) return null;
        const interest = outstanding * 0.09 * (daysElapsed / 365);
        const totalWithInterest = outstanding + interest;
        const yearsElapsed = (daysElapsed / 365).toFixed(1);
        return (
          <SectionCard
            title="Pre-Judgment Interest"
            description="NY CPLR §5001 — 9% per year from the date payment was due."
            collapsible
            defaultOpen
          >
            <div className="flex items-baseline gap-6 flex-wrap">
              <div>
                <div className="field-label mb-0.5">Principal</div>
                <div className="text-lg font-semibold text-slate-800">{formatCurrency(outstanding)}</div>
              </div>
              <div className="text-slate-300 text-xl self-center">+</div>
              <div>
                <div className="field-label mb-0.5">Interest ({yearsElapsed} yrs)</div>
                <div className="text-lg font-semibold text-slate-800">{formatCurrency(interest)}</div>
              </div>
              <div className="text-slate-300 text-xl self-center">=</div>
              <div>
                <div className="field-label mb-0.5">Total claim value</div>
                <div className="text-lg font-bold text-slate-900">{formatCurrency(totalWithInterest)}</div>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-3 leading-relaxed">
              Include pre-judgment interest in your demand letter and court filings. Interest runs from{' '}
              {new Date(caseData.paymentDueDate!).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.
            </p>
          </SectionCard>
        );
      })()}

      {/* Edit button */}
      {!editing && (
        <div className="flex justify-end">
          <button onClick={handleStartEdit} className="btn-secondary text-sm">
            <Pencil className="w-4 h-4" /> Edit Case Details
          </button>
        </div>
      )}

      {/* Inline edit form */}
      {editing && (
        <SectionCard title="Edit Case Details" padding="lg">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <div className="space-y-3">
              <div className="kbd-label mb-1">Claimant</div>
              {field('Name', 'claimantName')}
              {field('Business', 'claimantBusiness')}
              {field('Address', 'claimantAddress')}
              {field('Email', 'claimantEmail', 'email')}
              {field('Phone', 'claimantPhone', 'tel')}
            </div>
            <div className="space-y-3">
              <div className="kbd-label mb-1">Debtor</div>
              {field('Name', 'debtorName')}
              {field('Business', 'debtorBusiness')}
              {field('Address', 'debtorAddress')}
              {field('Email', 'debtorEmail', 'email')}
              {field('Phone', 'debtorPhone', 'tel')}
              <div>
                <label className="field-label block mb-1">Entity Type</label>
                <select
                  className="input"
                  value={form.debtorEntityType}
                  onChange={(e) => setForm((f) => ({ ...f, debtorEntityType: e.target.value }))}
                >
                  <option value="">Unknown / Not set</option>
                  <option value="Individual / Sole Proprietor">Individual / Sole Proprietor</option>
                  <option value="LLC">LLC (Limited Liability Company)</option>
                  <option value="Corporation">Corporation (Inc. / Corp.)</option>
                  <option value="LLP">LLP (Limited Liability Partnership)</option>
                  <option value="Partnership">General Partnership</option>
                </select>
              </div>
              <div>
                <label className="field-label block mb-1">Industry</label>
                <select
                  className="input"
                  value={form.industry}
                  onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
                >
                  <option value="">Not specified</option>
                  <option value="Creative / Design / Marketing">Creative / Design / Marketing</option>
                  <option value="Technology / Software">Technology / Software</option>
                  <option value="Construction / Contracting">Construction / Contracting</option>
                  <option value="Professional Services">Professional Services (Consulting, Accounting, Legal)</option>
                  <option value="Healthcare / Medical">Healthcare / Medical</option>
                  <option value="Real Estate">Real Estate</option>
                  <option value="Retail / Wholesale / Distribution">Retail / Wholesale / Distribution</option>
                  <option value="Food & Beverage / Hospitality">Food & Beverage / Hospitality</option>
                  <option value="Transportation / Logistics">Transportation / Logistics</option>
                  <option value="Media / Entertainment">Media / Entertainment</option>
                  <option value="Financial Services">Financial Services</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 mt-4">
            {field('Amount Owed', 'amountOwed', 'number')}
            {field('Amount Paid', 'amountPaid', 'number')}
            {field('Invoice Number', 'invoiceNumber')}
            <label className="flex items-center gap-2 pt-6 text-sm text-slate-700">
              <input
                type="checkbox"
                className="rounded border-slate-300"
                checked={form.hasWrittenContract}
                onChange={(e) => setForm((f) => ({ ...f, hasWrittenContract: e.target.checked }))}
              />
              Has Written Contract
            </label>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 mt-4">
            {field('Agreement Date', 'agreementDate', 'date')}
            {field('Invoice Date', 'invoiceDate', 'date')}
            {field('Payment Due Date', 'paymentDueDate', 'date')}
            {field('Service Start Date', 'serviceStartDate', 'date')}
            {field('Service End Date', 'serviceEndDate', 'date')}
          </div>
          <div className="mt-4 space-y-4">
            {field('Service Description', 'serviceDescription', 'textarea')}
            {field('Notes', 'notes', 'textarea')}
          </div>
          <div className="flex gap-3 pt-4">
            <button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="btn-primary"
            >
              {updateMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Changes
            </button>
            <button onClick={() => setEditing(false)} className="btn-secondary">
              Cancel
            </button>
          </div>
          {updateMutation.isError && (
            <div className="mt-3"><Alert tone="danger">Failed to save. Please try again.</Alert></div>
          )}
        </SectionCard>
      )}

      {/* Parties */}
      {!editing && (
        <div className="grid grid-cols-2 gap-4">
          <PartyCard label="Claimant (You)" party={{
            business: caseData.claimantBusiness,
            name: caseData.claimantName,
            address: caseData.claimantAddress,
            email: caseData.claimantEmail,
            phone: caseData.claimantPhone,
          }} />
          <PartyCard
            label="Debtor"
            party={{
              business: caseData.debtorBusiness,
              name: caseData.debtorName,
              address: caseData.debtorAddress,
              email: caseData.debtorEmail,
              phone: caseData.debtorPhone,
            }}
            chips={[caseData.debtorEntityType, caseData.industry].filter(Boolean) as string[]}
          />
        </div>
      )}

      {/* Key dates & SOL */}
      <SectionCard title="Key Dates" collapsible defaultOpen>
        <dl className="grid grid-cols-3 gap-x-4 gap-y-3">
          {[
            { label: 'Agreement Date', value: formatDate(caseData.agreementDate) },
            { label: 'Service Start', value: formatDate(caseData.serviceStartDate) },
            { label: 'Service End', value: formatDate(caseData.serviceEndDate) },
            { label: 'Invoice Date', value: formatDate(caseData.invoiceDate) },
            { label: 'Payment Due', value: formatDate(caseData.paymentDueDate) },
            { label: 'Invoice #', value: caseData.invoiceNumber || '—' },
          ].map(({ label, value }) => (
            <div key={label}>
              <dt className="field-label mb-0.5">{label}</dt>
              <dd className="field-value">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="divider my-4" />
        <Alert tone={SOL_STATUS_TONE[sol.status]} title="Statute of Limitations (CPLR §213)">
          {sol.label}
        </Alert>
      </SectionCard>

      {/* AI strength */}
      {caseData.caseStrength && (
        <SectionCard title="AI Case Assessment">
          <div className="flex items-center gap-3 mb-3">
            <Badge tone={STRENGTH_TONES[caseData.caseStrength] ?? 'neutral'} size="lg">
              {caseData.caseStrength.charAt(0).toUpperCase() + caseData.caseStrength.slice(1)} Case
            </Badge>
          </div>
          {caseData.caseSummary && (
            <p className="text-sm text-slate-600 leading-relaxed">{caseData.caseSummary}</p>
          )}
        </SectionCard>
      )}

      {/* Evidence on file */}
      {evidenceSummary && (
        <SectionCard title="Evidence on File" collapsible defaultOpen>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Contract', key: 'hasContract' },
              { label: 'Invoice', key: 'hasInvoice' },
              { label: 'Proof of Work', key: 'hasProofOfWork' },
              { label: 'Communications', key: 'hasCommunication' },
              { label: 'Payment Records', key: 'hasPaymentRecord' },
            ].map(({ label, key }) => (
              <div
                key={key}
                className={`flex items-center gap-2 text-sm ${evidenceSummary[key] ? 'text-emerald-700' : 'text-slate-400'}`}
              >
                {evidenceSummary[key] ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <CircleDashed className="w-4 h-4 shrink-0" />
                )}
                {label}
              </div>
            ))}
          </div>
          {evidenceSummary.strongestEvidence != null && (
            <>
              <div className="divider my-3" />
              <div className="text-xs">
                <span className="text-slate-500">Strongest evidence: </span>
                <span className="text-slate-700">{String(evidenceSummary.strongestEvidence)}</span>
              </div>
            </>
          )}
        </SectionCard>
      )}

      {/* Missing info */}
      {missingInfo.length > 0 && (
        <SectionCard title="Missing Information" collapsible defaultOpen>
          <div className="space-y-2">
            {missingInfo.map((raw, i) => {
              if (typeof raw === 'string') {
                return <Alert key={i} tone="warning">{raw}</Alert>;
              }
              const item = raw as MissingInfoItem;
              return (
                <Alert
                  key={i}
                  tone={IMPACT_TONE[item.impact]}
                  title={
                    <div className="flex items-center gap-2">
                      <span>{item.item}</span>
                      <Badge tone={IMPACT_TONE[item.impact]} size="sm">{item.impact.toUpperCase()}</Badge>
                    </div>
                  }
                >
                  <p className="text-xs leading-relaxed">{item.consequence}</p>
                  {item.workaround && (
                    <p className="text-xs mt-1.5 pl-2 border-l-2 border-emerald-300 text-emerald-800 leading-relaxed">
                      <strong>Workaround:</strong> {item.workaround}
                    </p>
                  )}
                </Alert>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* Service description */}
      {caseData.serviceDescription && (
        <SectionCard title="Services / Work Performed" collapsible defaultOpen>
          <p className="text-sm text-slate-700 leading-relaxed">{caseData.serviceDescription}</p>
        </SectionCard>
      )}
    </div>
  );
}

function PartyCard({
  label,
  party,
  chips,
}: {
  label: string;
  party: { business: string | null; name: string | null; address: string | null; email: string | null; phone: string | null };
  chips?: string[];
}) {
  return (
    <div className="card p-5">
      <div className="kbd-label mb-3">{label}</div>
      <div className="space-y-1">
        {party.business && <div className="font-semibold text-slate-900">{party.business}</div>}
        {party.name && <div className="text-sm text-slate-700">{party.name}</div>}
        {party.address && <div className="text-sm text-slate-500">{party.address}</div>}
        {party.email && <div className="text-sm text-slate-500">{party.email}</div>}
        {party.phone && <div className="text-sm text-slate-500">{party.phone}</div>}
        {!party.business && !party.name && !party.address && !party.email && !party.phone && (
          <div className="text-sm text-slate-400 italic">No details on file</div>
        )}
        {chips && chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {chips.map((c) => <Badge key={c} tone="neutral" size="sm">{c}</Badge>)}
          </div>
        )}
      </div>
    </div>
  );
}

function makeForm(caseData: Case) {
  return {
    claimantName: caseData.claimantName || '',
    claimantBusiness: caseData.claimantBusiness || '',
    claimantAddress: caseData.claimantAddress || '',
    claimantEmail: caseData.claimantEmail || '',
    claimantPhone: caseData.claimantPhone || '',
    debtorName: caseData.debtorName || '',
    debtorBusiness: caseData.debtorBusiness || '',
    debtorAddress: caseData.debtorAddress || '',
    debtorEmail: caseData.debtorEmail || '',
    debtorPhone: caseData.debtorPhone || '',
    debtorEntityType: caseData.debtorEntityType || '',
    industry: caseData.industry || '',
    amountOwed: caseData.amountOwed || '',
    amountPaid: caseData.amountPaid || '',
    serviceDescription: caseData.serviceDescription || '',
    invoiceNumber: caseData.invoiceNumber || '',
    hasWrittenContract: caseData.hasWrittenContract,
    notes: caseData.notes || '',
    agreementDate: caseData.agreementDate?.slice(0, 10) || '',
    invoiceDate: caseData.invoiceDate?.slice(0, 10) || '',
    paymentDueDate: caseData.paymentDueDate?.slice(0, 10) || '',
    serviceStartDate: caseData.serviceStartDate?.slice(0, 10) || '',
    serviceEndDate: caseData.serviceEndDate?.slice(0, 10) || '',
  };
}
