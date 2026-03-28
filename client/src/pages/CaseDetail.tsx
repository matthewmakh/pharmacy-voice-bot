import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  FileText,
  Upload,
  Zap,
  BarChart3,
  Clock,
  CheckCircle,
  AlertCircle,
  Loader2,
  Trash2,
  Send,
  Eye,
  X,
  Copy,
  Mail,
  Scale,
  MapPin,
  Pencil,
  Shield,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  getCase,
  analyzeCase,
  setStrategy,
  generateLetter,
  generateFinalNotice,
  generateCourtForm,
  generateDefaultJudgment,
  uploadDocuments,
  deleteDocument,
  logAction,
  updateCase,
  getDocumentViewUrl,
  resetAnalysis,
  lookupACRIS,
  lookupCourtHistory,
} from '../lib/api';
import {
  formatCurrency,
  formatDate,
  STATUS_LABELS,
  STATUS_COLORS,
  STRATEGY_LABELS,
  DOC_CLASSIFICATION_LABELS,
  DOC_CLASSIFICATION_COLORS,
  STRENGTH_COLORS,
  formatFileSize,
} from '../lib/utils';
import type { Case, Strategy, ActionType, MissingInfoItem, CaseAssessment } from '../types';
import UploadZone from '../components/evidence/UploadZone';

// ─── Rotating Facts Loader ─────────────────────────────────────────────────────

const LOADING_FACTS = [
  'In New York, Commercial Claims Court caps recovery at $10,000 — but costs just $25 to file.',
  'A demand letter sent via certified mail creates a paper trail courts take seriously.',
  'Defendants have 20 days to respond after personal service in NY Civil Court — mark it immediately.',
  'Account stated is a powerful cause of action: if you sent an invoice and they didn\'t dispute it, the debt may be legally acknowledged.',
  'NYC City Marshals collect roughly 5% of the judgment amount as their fee — recoverable from the debtor.',
  'Quantum meruit means "as much as deserved" — it lets you collect even without a signed contract.',
  'Filing in the wrong county is one of the most common pro se mistakes. Always file where the defendant does business.',
  'Winning a judgment is step one. Enforcing it — bank levy, property lien, income execution — is step two.',
  'The 120-day service window starts the day you file, not the day you serve. Calendar it immediately.',
  'An Affidavit of Service must be notarized and filed with the court promptly — don\'t sit on it.',
  'In NY Supreme Court, e-filing is mandatory for represented parties on NYSCEF. Pro se filers are exempt unless they opt in.',
  'Partial payment by a debtor is powerful evidence — it shows they acknowledged the debt.',
  'Interest runs at 9% per year on NY judgments under CPLR § 5004.',
  'A default judgment can be entered if the defendant fails to appear or answer by the deadline.',
  'The RJI (Request for Judicial Intervention) must be filed within 60 days to get a judge assigned in Supreme Court.',
  'New York\'s "account stated" doctrine means an unpaid invoice that went undisputed can be treated as an accepted debt.',
  'For businesses suing in Commercial Claims, you can file up to 5 claims per month per claimant.',
  'A process server must be licensed in New York State — using an unlicensed server can invalidate service.',
  'Breach of contract, account stated, and quantum meruit are the three workhorses of B2B collections in New York.',
  'You can garnish up to 10% of gross wages in New York — but only for individual defendants, not business entities.',
  'A property lien prevents the debtor from selling or refinancing until your judgment is satisfied.',
  'Post-judgment discovery (a court-ordered deposition) lets you compel the debtor to disclose their bank accounts and assets.',
  'New York\'s statute of limitations for breach of written contract is 6 years; for oral contracts, also 6 years.',
  'If a corporate defendant is a shell or alter ego, you may be able to pierce the corporate veil and pursue personal assets.',
  'Certified mail with return receipt is the gold standard for proving a demand letter was delivered.',
  'The NYC Civil Court handles claims up to $50,000 — more than most people realize.',
  'A well-organized case file — chronological, labeled, with a one-page summary — makes a judge\'s job easier and your case stronger.',
  'Emails and text messages acknowledging the debt or promising payment are admissible as evidence in NY courts.',
  'Service by "nail and mail" (leaving at the address and mailing a copy) is allowed after two failed personal attempts.',
  'A judgment lien on real property in New York lasts 10 years and can be renewed for another 10.',
  'If the debtor files for bankruptcy, an automatic stay immediately halts all collection efforts — consult an attorney.',
  'Invoices with clear payment terms and due dates are significantly easier to collect on than vague billing statements.',
  'The longer you wait to pursue a debt, the harder it becomes — witnesses forget, documents get lost, businesses dissolve.',
  'Sending a final notice via both email and certified mail doubles your documentation of pre-filing efforts.',
  'A signed scope of work or proposal can substitute for a formal written contract in many NY court actions.',
];

function RotatingFact({ label, sublabel }: { label: string; sublabel?: string }) {
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * LOADING_FACTS.length));
  const [visible, setVisible] = useState(true);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx(i => {
          let next = Math.floor(Math.random() * LOADING_FACTS.length);
          if (next === i) next = (i + 1) % LOADING_FACTS.length;
          return next;
        });
        setVisible(true);
      }, 500);
    }, 5500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="card p-8 text-center">
      <Loader2 className="w-10 h-10 text-purple-500 mx-auto mb-4 animate-spin" />
      <div className="text-sm font-semibold text-slate-800 mb-1">{label}</div>
      {sublabel && <p className="text-xs text-slate-400 mb-6">{sublabel}</p>}
      <div
        className="mt-4 mx-auto max-w-sm transition-opacity duration-500"
        style={{ opacity: visible ? 1 : 0 }}
      >
        <div className="text-xs font-semibold text-purple-500 uppercase tracking-wider mb-2">Did you know?</div>
        <p className="text-sm text-slate-600 leading-relaxed italic">"{LOADING_FACTS[idx]}"</p>
      </div>
    </div>
  );
}

// ─── SOL Calculator ────────────────────────────────────────────────────────────

function computeSOL(paymentDueDate: string | null | undefined): {
  solDate: Date | null;
  daysRemaining: number | null;
  status: 'ok' | 'warning' | 'urgent' | 'expired' | 'unknown';
  label: string;
  solDateFormatted: string | null;
} {
  if (!paymentDueDate) {
    return { solDate: null, daysRemaining: null, status: 'unknown', label: 'Unknown — payment due date not set', solDateFormatted: null };
  }
  const breach = new Date(paymentDueDate);
  if (isNaN(breach.getTime())) {
    return { solDate: null, daysRemaining: null, status: 'unknown', label: 'Unknown — invalid date', solDateFormatted: null };
  }
  // NY CPLR §213: 6 years from breach date for breach of contract (written or oral) and account stated
  const solDate = new Date(breach);
  solDate.setFullYear(solDate.getFullYear() + 6);
  const today = new Date();
  const daysRemaining = Math.floor((solDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const solDateFormatted = solDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  if (daysRemaining < 0) {
    return { solDate, daysRemaining, status: 'expired', label: `Expired ${Math.abs(daysRemaining)} days ago — consult an attorney immediately`, solDateFormatted };
  }
  if (daysRemaining <= 90) {
    return { solDate, daysRemaining, status: 'urgent', label: `${daysRemaining} days remaining — file immediately (expires ${solDateFormatted})`, solDateFormatted };
  }
  if (daysRemaining <= 365) {
    const months = Math.floor(daysRemaining / 30);
    return { solDate, daysRemaining, status: 'warning', label: `~${months} months remaining — file within the year (expires ${solDateFormatted})`, solDateFormatted };
  }
  const years = Math.floor(daysRemaining / 365);
  const remainingMonths = Math.floor((daysRemaining % 365) / 30);
  const label = remainingMonths > 0
    ? `${years} yr ${remainingMonths} mo remaining (expires ${solDateFormatted})`
    : `${years} yr remaining (expires ${solDateFormatted})`;
  return { solDate, daysRemaining, status: 'ok', label, solDateFormatted };
}

type Tab = 'overview' | 'evidence' | 'strategy' | 'letter' | 'escalation' | 'filing' | 'timeline';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'evidence', label: 'Evidence', icon: Upload },
  { id: 'strategy', label: 'Strategy', icon: Zap },
  { id: 'letter', label: 'Demand Letter', icon: FileText },
  { id: 'escalation', label: 'Escalation', icon: Shield },
  { id: 'filing', label: 'NY Filing Guide', icon: Scale },
  { id: 'timeline', label: 'Timeline', icon: Clock },
];

const ACTION_TYPE_OPTIONS: { value: ActionType; label: string }[] = [
  { value: 'CASE_UPDATED', label: 'Case Updated' },
  { value: 'DOCUMENTS_UPLOADED', label: 'Documents Uploaded' },
  { value: 'EMAIL_SENT', label: 'Email Sent' },
  { value: 'CERTIFIED_MAIL_SENT', label: 'Certified Mail Sent' },
  { value: 'REMINDER_SENT', label: 'Reminder Sent' },
  { value: 'FINAL_NOTICE_SENT', label: 'Final Notice Sent' },
  { value: 'LAWYER_REVIEW_REQUESTED', label: 'Lawyer Review Requested' },
  { value: 'FILING_PREPARED', label: 'Filing Prepared' },
  { value: 'SERVICE_INITIATED', label: 'Service Initiated' },
  { value: 'PAYMENT_RECEIVED', label: 'Payment Received' },
  { value: 'CASE_CLOSED', label: 'Case Closed' },
];

const ACTION_ICONS: Partial<Record<ActionType, React.ElementType>> = {
  CASE_CREATED: FileText,
  CASE_UPDATED: Pencil,
  DOCUMENTS_UPLOADED: Upload,
  AI_ANALYSIS_COMPLETED: Zap,
  STRATEGY_SELECTED: Zap,
  DEMAND_LETTER_GENERATED: FileText,
  FINAL_NOTICE_GENERATED: Shield,
  FILING_PACKET_GENERATED: FileText,
  COURT_FORM_GENERATED: Scale,
  DEFAULT_JUDGMENT_GENERATED: Scale,
  EMAIL_SENT: Mail,
  CERTIFIED_MAIL_SENT: Send,
  REMINDER_SENT: Send,
  FINAL_NOTICE_SENT: Shield,
  LAWYER_REVIEW_REQUESTED: Scale,
  FILING_PREPARED: MapPin,
  SERVICE_INITIATED: Send,
  PAYMENT_RECEIVED: CheckCircle,
  CASE_CLOSED: CheckCircle,
};

// ─── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ caseData }: { caseData: Case }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => ({
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
  }));

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
    // Clear empty date strings
    ['agreementDate', 'invoiceDate', 'paymentDueDate', 'serviceStartDate', 'serviceEndDate'].forEach((k) => {
      if (!payload[k]) payload[k] = null;
    });
    updateMutation.mutate(payload);
  };

  const handleStartEdit = () => {
    setForm({
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
    });
    setEditing(true);
  };

  const field = (label: string, key: string, type = 'text') => (
    <div key={key}>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {type === 'textarea' ? (
        <textarea
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          value={(form as Record<string, unknown>)[key] as string}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        />
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Key Numbers */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-5">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Amount Owed</div>
          <div className="text-2xl font-bold text-slate-900">{formatCurrency(caseData.amountOwed)}</div>
        </div>
        <div className="card p-5">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Amount Paid</div>
          <div className="text-2xl font-bold text-slate-900">{formatCurrency(caseData.amountPaid || 0)}</div>
        </div>
        <div className="card p-5 border-red-200 bg-red-50">
          <div className="text-xs font-semibold text-red-500 uppercase tracking-wider mb-1">Outstanding Balance</div>
          <div className="text-2xl font-bold text-red-600">{formatCurrency(outstanding)}</div>
        </div>
      </div>

      {/* Pre-judgment interest (NY CPLR §5001 — 9% per year from breach date) */}
      {outstanding > 0 && caseData.paymentDueDate && (() => {
        const breachDate = new Date(caseData.paymentDueDate!);
        const today = new Date();
        const daysElapsed = Math.max(0, Math.floor((today.getTime() - breachDate.getTime()) / 86400000));
        if (daysElapsed < 1) return null;
        const interest = outstanding * 0.09 * (daysElapsed / 365);
        const totalWithInterest = outstanding + interest;
        const yearsElapsed = (daysElapsed / 365).toFixed(1);
        return (
          <div className="card p-4 border-amber-100 bg-amber-50">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Pre-Judgment Interest</span>
              <span className="text-xs text-amber-600">NY CPLR §5001 — 9% per year</span>
            </div>
            <div className="flex items-baseline gap-4 mt-1">
              <div>
                <div className="text-xs text-amber-600 mb-0.5">Accrued interest ({yearsElapsed} yrs)</div>
                <div className="text-lg font-bold text-amber-700">{formatCurrency(interest)}</div>
              </div>
              <div className="text-slate-300 text-xl">+</div>
              <div>
                <div className="text-xs text-slate-500 mb-0.5">Principal</div>
                <div className="text-lg font-semibold text-slate-700">{formatCurrency(outstanding)}</div>
              </div>
              <div className="text-slate-300 text-xl">=</div>
              <div>
                <div className="text-xs text-slate-500 mb-0.5">Total claim value</div>
                <div className="text-lg font-bold text-slate-900">{formatCurrency(totalWithInterest)}</div>
              </div>
            </div>
            <p className="text-xs text-amber-600 mt-2 leading-relaxed">
              Include pre-judgment interest in your demand letter and court filings. Interest runs from the date payment was due ({new Date(caseData.paymentDueDate!).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}).
            </p>
          </div>
        );
      })()}

      {/* Edit Button */}
      {!editing && (
        <div className="flex justify-end">
          <button onClick={handleStartEdit} className="btn-secondary flex items-center gap-2 text-sm">
            <Pencil className="w-4 h-4" /> Edit Case Details
          </button>
        </div>
      )}

      {/* Inline Edit Form */}
      {editing && (
        <div className="card p-6 space-y-5 border-blue-200">
          <div className="text-sm font-semibold text-slate-700 mb-2">Edit Case Details</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Claimant</div>
              {field('Name', 'claimantName')}
              {field('Business', 'claimantBusiness')}
              {field('Address', 'claimantAddress')}
              {field('Email', 'claimantEmail', 'email')}
              {field('Phone', 'claimantPhone', 'tel')}
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Debtor</div>
              {field('Name', 'debtorName')}
              {field('Business', 'debtorBusiness')}
              {field('Address', 'debtorAddress')}
              {field('Email', 'debtorEmail', 'email')}
              {field('Phone', 'debtorPhone', 'tel')}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Entity Type</label>
                <select
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                <label className="block text-xs font-medium text-slate-600 mb-1">Industry</label>
                <select
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            {field('Amount Owed', 'amountOwed', 'number')}
            {field('Amount Paid', 'amountPaid', 'number')}
            {field('Invoice Number', 'invoiceNumber')}
            <div className="flex items-center gap-2 pt-6">
              {field('Written Contract?', 'hasWrittenContract', 'checkbox')}
              <span className="text-sm text-slate-600">Has Written Contract</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            {field('Agreement Date', 'agreementDate', 'date')}
            {field('Invoice Date', 'invoiceDate', 'date')}
            {field('Payment Due Date', 'paymentDueDate', 'date')}
            {field('Service Start Date', 'serviceStartDate', 'date')}
            {field('Service End Date', 'serviceEndDate', 'date')}
          </div>
          {field('Service Description', 'serviceDescription', 'textarea')}
          {field('Notes', 'notes', 'textarea')}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              {updateMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Changes
            </button>
            <button onClick={() => setEditing(false)} className="btn-secondary text-sm">
              Cancel
            </button>
          </div>
          {updateMutation.isError && (
            <p className="text-sm text-red-600">Failed to save. Please try again.</p>
          )}
        </div>
      )}

      {/* Parties */}
      {!editing && (
        <div className="grid grid-cols-2 gap-4">
          <div className="card p-5">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Claimant (You)</div>
            <div className="space-y-1">
              {caseData.claimantBusiness && <div className="font-semibold text-slate-900">{caseData.claimantBusiness}</div>}
              {caseData.claimantName && <div className="text-sm text-slate-700">{caseData.claimantName}</div>}
              {caseData.claimantAddress && <div className="text-sm text-slate-500">{caseData.claimantAddress}</div>}
              {caseData.claimantEmail && <div className="text-sm text-slate-500">{caseData.claimantEmail}</div>}
              {caseData.claimantPhone && <div className="text-sm text-slate-500">{caseData.claimantPhone}</div>}
            </div>
          </div>
          <div className="card p-5">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Debtor</div>
            <div className="space-y-1">
              {caseData.debtorBusiness && <div className="font-semibold text-slate-900">{caseData.debtorBusiness}</div>}
              {caseData.debtorName && <div className="text-sm text-slate-700">{caseData.debtorName}</div>}
              {caseData.debtorAddress && <div className="text-sm text-slate-500">{caseData.debtorAddress}</div>}
              {caseData.debtorEmail && <div className="text-sm text-slate-500">{caseData.debtorEmail}</div>}
              {caseData.debtorPhone && <div className="text-sm text-slate-500">{caseData.debtorPhone}</div>}
              <div className="flex flex-wrap gap-1 mt-1">
                {caseData.debtorEntityType && (
                  <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full">{caseData.debtorEntityType}</span>
                )}
                {caseData.industry && (
                  <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-xs rounded-full">{caseData.industry}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Key Dates */}
      <div className="card p-5">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Key Dates</div>
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Agreement Date', value: caseData.agreementDate },
            { label: 'Service Start', value: caseData.serviceStartDate },
            { label: 'Service End', value: caseData.serviceEndDate },
            { label: 'Invoice Date', value: caseData.invoiceDate },
            { label: 'Payment Due', value: caseData.paymentDueDate },
            { label: 'Invoice #', value: caseData.invoiceNumber },
          ].map(({ label, value }) => (
            <div key={label}>
              <div className="text-xs text-slate-400 mb-0.5">{label}</div>
              <div className="text-sm font-medium text-slate-800">
                {label === 'Invoice #' ? (value || '—') : formatDate(value)}
              </div>
            </div>
          ))}
        </div>
        {/* SOL Status */}
        {(() => {
          const sol = computeSOL(caseData.paymentDueDate);
          const cfg = {
            ok: { bar: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
            warning: { bar: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
            urgent: { bar: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50 border-red-200' },
            expired: { bar: 'bg-red-600', text: 'text-red-800', bg: 'bg-red-100 border-red-300' },
            unknown: { bar: 'bg-slate-300', text: 'text-slate-500', bg: 'bg-slate-50 border-slate-200' },
          }[sol.status];
          return (
            <div className={`mt-4 pt-4 border-t border-slate-100 flex items-center gap-3 p-3 rounded-lg border ${cfg.bg}`}>
              <div className={`w-2 h-2 rounded-full shrink-0 ${cfg.bar}`} />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mr-2">Statute of Limitations</span>
                <span className={`text-xs font-medium ${cfg.text}`}>{sol.label}</span>
              </div>
              {sol.status === 'expired' && (
                <span className="text-xs font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full shrink-0">EXPIRED</span>
              )}
              {sol.status === 'urgent' && (
                <span className="text-xs font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full shrink-0">URGENT</span>
              )}
            </div>
          );
        })()}
      </div>

      {/* AI Analysis */}
      {caseData.caseStrength && (
        <div className="card p-5">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">AI Case Assessment</div>
          <div className="flex items-center gap-3 mb-3">
            <span className={`text-lg font-bold capitalize ${STRENGTH_COLORS[caseData.caseStrength] || 'text-slate-700'}`}>
              {caseData.caseStrength} Case
            </span>
          </div>
          {caseData.caseSummary && (
            <p className="text-sm text-slate-600 leading-relaxed">{caseData.caseSummary}</p>
          )}
        </div>
      )}

      {/* Evidence Summary */}
      {evidenceSummary && (
        <div className="card p-5">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Evidence on File</div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Contract', key: 'hasContract' },
              { label: 'Invoice', key: 'hasInvoice' },
              { label: 'Proof of Work', key: 'hasProofOfWork' },
              { label: 'Communications', key: 'hasCommunication' },
              { label: 'Payment Records', key: 'hasPaymentRecord' },
            ].map(({ label, key }) => (
              <div key={key} className={`flex items-center gap-2 text-sm ${evidenceSummary[key] ? 'text-emerald-700' : 'text-slate-400'}`}>
                {evidenceSummary[key] ? (
                  <CheckCircle className="w-4 h-4 shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border-2 border-slate-300 shrink-0" />
                )}
                {label}
              </div>
            ))}
          </div>
          {evidenceSummary.strongestEvidence != null && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <span className="text-xs text-slate-500">Strongest evidence: </span>
              <span className="text-xs text-slate-700">{String(evidenceSummary.strongestEvidence)}</span>
            </div>
          )}
        </div>
      )}

      {/* Missing Info — with legal consequences */}
      {missingInfo.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Missing Information</div>
          {missingInfo.map((raw, i) => {
            // Handle both old string[] format and new MissingInfoItem format
            if (typeof raw === 'string') {
              return (
                <div key={i} className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <span className="text-sm text-amber-800">{raw}</span>
                </div>
              );
            }
            const item = raw as MissingInfoItem;
            const impactCfg = {
              high: { border: 'border-red-200 bg-red-50', badge: 'bg-red-100 text-red-700', icon: 'text-red-500' },
              medium: { border: 'border-amber-200 bg-amber-50', badge: 'bg-amber-100 text-amber-700', icon: 'text-amber-500' },
              low: { border: 'border-slate-200 bg-slate-50', badge: 'bg-slate-100 text-slate-600', icon: 'text-slate-400' },
            }[item.impact];
            return (
              <div key={i} className={`p-4 rounded-lg border ${impactCfg.border}`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <AlertCircle className={`w-4 h-4 shrink-0 ${impactCfg.icon}`} />
                  <span className="text-sm font-semibold text-slate-800">{item.item}</span>
                  <span className={`ml-auto text-xs font-bold uppercase px-2 py-0.5 rounded-full ${impactCfg.badge}`}>{item.impact}</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">{item.consequence}</p>
                {item.workaround && (
                  <p className="text-xs text-emerald-700 mt-1.5 pl-1 border-l-2 border-emerald-300 leading-relaxed">
                    <strong>Workaround:</strong> {item.workaround}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Service Description */}
      {caseData.serviceDescription && (
        <div className="card p-5">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Services / Work Performed</div>
          <p className="text-sm text-slate-700 leading-relaxed">{caseData.serviceDescription}</p>
        </div>
      )}
    </div>
  );
}

// ─── Evidence Tab ──────────────────────────────────────────────────────────────

function EvidenceTab({ caseData, onRefresh }: { caseData: Case; onRefresh: () => void }) {
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<typeof caseData.documents[number] | null>(null);

  const handleUpload = async (files: File[]) => {
    setUploading(true);
    try {
      await uploadDocuments(caseData.id, files);
      queryClient.invalidateQueries({ queryKey: ['case', caseData.id] });
      onRefresh();
    } finally {
      setUploading(false);
    }
  };

  const deleteMutation = useMutation({
    mutationFn: (docId: string) => deleteDocument(caseData.id, docId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });

  return (
    <div className="space-y-6">
      <UploadZone onUpload={handleUpload} uploading={uploading} />

      {caseData.documents.length > 0 && (
        <div className="card divide-y divide-slate-100">
          {caseData.documents.map((doc) => (
            <div key={doc.id} className="flex items-center gap-4 p-4">
              <FileText className="w-5 h-5 text-slate-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-800 truncate">{doc.originalName}</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {formatFileSize(doc.size)} · {formatDate(doc.uploadedAt)}
                </div>
              </div>
              {doc.classification === null ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-slate-100 text-slate-500 rounded-full">
                  <Loader2 className="w-3 h-3 animate-spin" /> Analyzing...
                </span>
              ) : (
                <span className={`inline-flex px-2.5 py-1 text-xs font-medium rounded-full ${DOC_CLASSIFICATION_COLORS[doc.classification] || 'bg-slate-100 text-slate-600'}`}>
                  {DOC_CLASSIFICATION_LABELS[doc.classification] || doc.classification}
                </span>
              )}
              <button
                onClick={() => setPreviewDoc(doc)}
                className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors"
                title="Preview"
              >
                <Eye className="w-4 h-4" />
              </button>
              <button
                onClick={() => deleteMutation.mutate(doc.id)}
                disabled={deleteMutation.isPending}
                className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"
                title="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {caseData.documents.length === 0 && (
        <div className="text-center py-8 text-sm text-slate-400">
          No documents uploaded yet. Upload contracts, invoices, emails, and other evidence above.
        </div>
      )}

      {/* Preview Modal */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setPreviewDoc(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col m-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="text-sm font-semibold text-slate-800 truncate">{previewDoc.originalName}</div>
              <button onClick={() => setPreviewDoc(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              {previewDoc.mimeType.startsWith('image/') ? (
                <img
                  src={getDocumentViewUrl(caseData.id, previewDoc.id)}
                  alt={previewDoc.originalName}
                  className="max-w-full mx-auto rounded-lg"
                />
              ) : previewDoc.mimeType === 'application/pdf' ? (
                <iframe
                  src={getDocumentViewUrl(caseData.id, previewDoc.id)}
                  className="w-full h-[70vh] rounded-lg border border-slate-200"
                  title={previewDoc.originalName}
                />
              ) : (
                <div className="text-sm text-slate-500 text-center py-12">
                  Preview not available for this file type. Use the download link to view.
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-100">
              <button
                onClick={() => {
                  deleteMutation.mutate(previewDoc.id);
                  setPreviewDoc(null);
                }}
                className="btn-secondary text-sm text-red-600 hover:text-red-700"
              >
                <Trash2 className="w-4 h-4 inline mr-1" /> Delete
              </button>
              <button onClick={() => setPreviewDoc(null)} className="btn-secondary text-sm">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Strategy Tab ──────────────────────────────────────────────────────────────

function StrategyTab({ caseData }: { caseData: Case }) {
  const queryClient = useQueryClient();

  const analyzeMutation = useMutation({
    mutationFn: () => analyzeCase(caseData.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });

  const strategyMutation = useMutation({
    mutationFn: (strategy: Strategy) => setStrategy(caseData.id, strategy),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });

  const resetMutation = useMutation({
    mutationFn: () => resetAnalysis(caseData.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });

  const [acrisResult, setAcrisResult] = useState<{
    found: boolean; totalRecords: number; asGrantee: number; asGrantor: number;
    searchedName: string; note: string; error?: string;
  } | null>(null);
  const [acrisLoading, setAcrisLoading] = useState(false);

  const handleACRISLookup = async () => {
    setAcrisLoading(true);
    try {
      const result = await lookupACRIS(caseData.id);
      setAcrisResult(result);
    } catch {
      setAcrisResult({ found: false, totalRecords: 0, asGrantee: 0, asGrantor: 0, searchedName: '', note: '', error: 'Lookup failed' });
    } finally {
      setAcrisLoading(false);
    }
  };

  const [courtHistoryResult, setCourtHistoryResult] = useState<{
    found: boolean; totalCases: number; asDefendant: number; asPlaintiff: number;
    cases: Array<{ caseIndex: string; filedDate: string | null; plaintiff: string; defendant: string; caseType: string; status: string; court: string; amount: string | null }>;
    searchedName: string; note: string; error?: string; scraperNote?: string;
  } | null>(null);
  const [courtHistoryLoading, setCourtHistoryLoading] = useState(false);

  const handleCourtHistoryLookup = async () => {
    setCourtHistoryLoading(true);
    try {
      const result = await lookupCourtHistory(caseData.id);
      setCourtHistoryResult(result);
    } catch {
      setCourtHistoryResult({ found: false, totalCases: 0, asDefendant: 0, asPlaintiff: 0, cases: [], searchedName: '', note: '', error: 'Lookup failed' });
    } finally {
      setCourtHistoryLoading(false);
    }
  };

  const strategies: { id: Strategy; title: string; description: string; traits: string[] }[] = [
    {
      id: 'QUICK_ESCALATION',
      title: 'Quick Escalation',
      description: 'A direct, formal path. Fewer soft reminders. Faster move to demand letter and stronger escalation.',
      traits: ['Firm tone', 'Short deadlines', 'Skip soft reminders'],
    },
    {
      id: 'STANDARD_RECOVERY',
      title: 'Standard Recovery',
      description: 'A balanced path with a reminder, demand, and follow-up structure.',
      traits: ['Professional tone', 'Standard deadlines', 'Balanced approach'],
    },
    {
      id: 'GRADUAL_APPROACH',
      title: 'Gradual Approach',
      description: 'A softer sequence with more reminders and a slower escalation curve.',
      traits: ['Diplomatic tone', 'Extended deadlines', 'Multiple reminders'],
    },
  ];

  const needsAnalysis = !caseData.caseStrength && !['ANALYZING'].includes(caseData.status);
  const isAnalyzing = caseData.status === 'ANALYZING' || analyzeMutation.isPending;

  return (
    <div className="space-y-6">
      {needsAnalysis && (
        <div className="card p-6 text-center">
          <Zap className="w-10 h-10 text-purple-500 mx-auto mb-3" />
          <div className="text-sm font-semibold text-slate-800 mb-1">Run AI Analysis</div>
          <p className="text-sm text-slate-500 mb-4 max-w-md mx-auto">
            Analyze your case to get a strength assessment, evidence summary, and strategy recommendations.
          </p>
          <button
            onClick={() => analyzeMutation.mutate()}
            disabled={analyzeMutation.isPending}
            className="btn-primary"
          >
            {analyzeMutation.isPending && <Loader2 className="w-4 h-4 animate-spin inline mr-2" />}
            Run AI Analysis
          </button>
          {analyzeMutation.isError && (
            <p className="text-xs text-red-500 mt-3">
              Error: {(analyzeMutation.error as { response?: { data?: { error?: string; details?: string } } })?.response?.data?.error || String(analyzeMutation.error)}
              {(analyzeMutation.error as { response?: { data?: { details?: string } } })?.response?.data?.details && (
                <span className="block mt-1 text-red-400">{(analyzeMutation.error as { response?: { data?: { details?: string } } })?.response?.data?.details}</span>
              )}
            </p>
          )}
        </div>
      )}

      {isAnalyzing && (
        <RotatingFact label="Analyzing your case..." sublabel="This usually takes 15–30 seconds." />
      )}

      {/* Analysis results */}
      {caseData.caseStrength && (() => {
        const a = caseData.caseAssessment as CaseAssessment | null;
        const theoryLabels: Record<string, string> = {
          breach_of_written_contract: 'Breach of Written Contract',
          breach_of_oral_contract: 'Breach of Oral Contract',
          account_stated: 'Account Stated',
          quantum_meruit: 'Quantum Meruit',
        };
        const riskCfg = {
          low: { bg: 'bg-emerald-50 border-emerald-200', badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
          medium: { bg: 'bg-amber-50 border-amber-200', badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
          high: { bg: 'bg-red-50 border-red-200', badge: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
        };
        const sol = computeSOL(caseData.paymentDueDate);
        const solCfg = {
          ok: 'text-emerald-700 bg-emerald-50 border-emerald-200',
          warning: 'text-amber-700 bg-amber-50 border-amber-200',
          urgent: 'text-red-700 bg-red-50 border-red-200',
          expired: 'text-red-800 bg-red-100 border-red-300',
          unknown: 'text-slate-500 bg-slate-50 border-slate-200',
        }[sol.status];

        return (
          <div className="space-y-4">
            {/* Disclaimer */}
            <div className="flex items-start gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500 leading-relaxed">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
              AI-assisted analysis — legal framework is grounded in NY law, but element-by-element assessment is based on AI reasoning from your documents, not legal research or case precedent. Not a legal opinion. Verify entity status via Middesk before relying on enforcement path guidance.
            </div>

            {/* Header: strength + reset */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`text-lg font-bold capitalize ${STRENGTH_COLORS[caseData.caseStrength] || 'text-slate-700'}`}>
                  {caseData.caseStrength} Case
                </span>
                {a?.recommendedStrategy && (
                  <span className="text-xs text-slate-500">
                    AI recommends: <span className="font-semibold text-slate-700">{strategies.find(s => s.id === a.recommendedStrategy)?.title}</span>
                  </span>
                )}
              </div>
              <button
                onClick={() => resetMutation.mutate()}
                disabled={resetMutation.isPending}
                className="text-xs text-slate-400 hover:text-red-500 transition-colors"
              >
                {resetMutation.isPending ? 'Resetting...' : 'Reset & Re-run'}
              </button>
            </div>

            {caseData.caseSummary && (
              <p className="text-sm text-slate-600 leading-relaxed">{caseData.caseSummary}</p>
            )}

            {/* Legal Theory */}
            {a?.primaryCauseOfAction && (
              <div className="card p-5">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Legal Theory</div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-bold text-slate-800">{theoryLabels[a.primaryCauseOfAction.theory] || a.primaryCauseOfAction.theory}</span>
                  <span className="text-xs text-slate-400">— primary</span>
                </div>
                <p className="text-xs text-slate-500 mb-3 leading-relaxed">{a.primaryCauseOfAction.reasoning}</p>
                <div className="space-y-1.5">
                  {a.primaryCauseOfAction.elements.map((el, i) => (
                    <div key={i} className="flex items-start gap-2">
                      {el.satisfied ? (
                        <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border-2 border-red-300 shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-medium text-slate-700">{el.element}</span>
                        {el.satisfied && el.evidence && (
                          <span className="text-xs text-slate-400 ml-1">— {el.evidence}</span>
                        )}
                        {!el.satisfied && el.gap && (
                          <span className="text-xs text-red-500 ml-1">— {el.gap}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {a.alternativeCauses.length > 0 && (
                  <p className="text-xs text-slate-400 mt-3 pt-3 border-t border-slate-100">
                    Also plead in the alternative: {a.alternativeCauses.join(', ')}
                  </p>
                )}
              </div>
            )}

            {/* Counterclaim Risk + Debtor Entity + SOL in a row */}
            <div className="grid grid-cols-1 gap-3">
              {a?.counterclaimRisk && (() => {
                const risk = a.counterclaimRisk;
                const cfg = riskCfg[risk.level] || riskCfg.medium;
                return (
                  <div className={`p-4 rounded-lg border ${cfg.bg}`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                      <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Counterclaim Risk</span>
                      <span className={`ml-auto text-xs font-bold uppercase px-2 py-0.5 rounded-full ${cfg.badge}`}>{risk.level}</span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed mb-2">{risk.reasoning}</p>
                    {risk.signals.length > 0 && (
                      <ul className="space-y-0.5">
                        {risk.signals.map((s, i) => (
                          <li key={i} className="text-xs text-slate-500 flex items-start gap-1.5">
                            <span className="text-slate-300 shrink-0">—</span>{s}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })()}

              {a?.debtorEntityNotes && (
                <div className="p-4 rounded-lg border border-slate-200 bg-slate-50">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Enforcement Path</div>
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium ml-auto">Entity unverified — confirm via Middesk</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed mb-3">{a.debtorEntityNotes}</p>
                  {/* ACRIS NYC Property Check */}
                  <div className="pt-3 border-t border-slate-100">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">NYC Property Records (ACRIS)</span>
                      {!acrisResult && (
                        <button
                          onClick={handleACRISLookup}
                          disabled={acrisLoading}
                          className="text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 font-medium flex items-center gap-1 transition-colors"
                        >
                          {acrisLoading ? <><Loader2 className="w-3 h-3 animate-spin" />Checking...</> : 'Run ACRIS Lookup'}
                        </button>
                      )}
                    </div>
                    {!acrisResult && !acrisLoading && (
                      <p className="text-xs text-slate-400 leading-relaxed">Check if debtor owns NYC real property — a post-judgment lien can prevent them from selling or refinancing. Free NYC Open Data lookup.</p>
                    )}
                    {acrisResult && (
                      <div className={`p-3 rounded-lg border text-xs ${acrisResult.error ? 'border-slate-200 bg-slate-50' : acrisResult.found ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
                        {acrisResult.error ? (
                          <p className="text-slate-500">{acrisResult.error}</p>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className={`font-semibold ${acrisResult.found ? 'text-emerald-700' : 'text-slate-600'}`}>
                                {acrisResult.found ? `${acrisResult.totalRecords} record(s) found` : 'No records found'}
                              </span>
                              {acrisResult.found && (
                                <span className="text-slate-400">· {acrisResult.searchedName}</span>
                              )}
                              <button onClick={handleACRISLookup} disabled={acrisLoading} className="ml-auto text-slate-400 hover:text-slate-600 text-xs">Refresh</button>
                            </div>
                            <p className="text-slate-600 leading-relaxed">{acrisResult.note}</p>
                            {acrisResult.found && (
                              <p className="text-slate-400 mt-1.5">Verify at: <strong>a836-acris.nyc.gov</strong> → Document Search → Party Name Search</p>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* SOL */}
              <div className={`p-4 rounded-lg border ${solCfg} flex items-start gap-2`}>
                <div className="flex-1">
                  <span className="text-xs font-semibold uppercase tracking-wider opacity-70 block mb-0.5">Statute of Limitations (CPLR §213)</span>
                  <span className="text-xs font-medium leading-relaxed">{sol.label}</span>
                  {sol.status === 'expired' && (
                    <p className="text-xs mt-1 opacity-80">The claim may be time-barred. Consult a NY-licensed attorney before taking any action.</p>
                  )}
                </div>
              </div>

              {/* NYC Civil Court History */}
              <div className="p-4 rounded-lg border border-slate-200 bg-slate-50">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">NYC Civil Court History</span>
                  {!courtHistoryResult && (
                    <button
                      onClick={handleCourtHistoryLookup}
                      disabled={courtHistoryLoading}
                      className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200 font-medium flex items-center gap-1 transition-colors"
                    >
                      {courtHistoryLoading ? <><Loader2 className="w-3 h-3 animate-spin" />Searching...</> : 'Search Court Records'}
                    </button>
                  )}
                  {courtHistoryResult && (
                    <button onClick={handleCourtHistoryLookup} disabled={courtHistoryLoading} className="text-xs text-slate-400 hover:text-slate-600">Refresh</button>
                  )}
                </div>
                {!courtHistoryResult && !courtHistoryLoading && (
                  <p className="text-xs text-slate-400 leading-relaxed">Search NYC Civil Court records for prior cases against this debtor — prior judgments, defaults, or serial non-payment patterns change your strategy.</p>
                )}
                {courtHistoryResult && (
                  <div className="space-y-2">
                    {courtHistoryResult.error ? (
                      <div className="text-xs text-slate-500">
                        <p>{courtHistoryResult.error}</p>
                        {courtHistoryResult.scraperNote && <p className="mt-1 text-slate-400 italic">{courtHistoryResult.scraperNote}</p>}
                      </div>
                    ) : (
                      <>
                        <div className={`text-xs font-semibold ${courtHistoryResult.found ? (courtHistoryResult.asDefendant > 2 ? 'text-amber-700' : 'text-slate-700') : 'text-slate-500'}`}>
                          {courtHistoryResult.found ? `${courtHistoryResult.totalCases} case(s) found — ${courtHistoryResult.asDefendant} as defendant` : 'No prior cases found'}
                        </div>
                        <p className="text-xs text-slate-600 leading-relaxed">{courtHistoryResult.note}</p>
                        {courtHistoryResult.found && courtHistoryResult.cases.length > 0 && (
                          <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                            {courtHistoryResult.cases.slice(0, 6).map((c, i) => (
                              <div key={i} className="flex gap-2 text-xs p-1.5 bg-white rounded border border-slate-100">
                                <span className="text-slate-400 shrink-0 font-mono">{c.caseIndex}</span>
                                <span className="text-slate-600 truncate">{c.plaintiff} v. {c.defendant}</span>
                                <span className="text-slate-400 shrink-0">{c.status}</span>
                              </div>
                            ))}
                            {courtHistoryResult.cases.length > 6 && (
                              <p className="text-xs text-slate-400">+{courtHistoryResult.cases.length - 6} more — verify at iapps.courts.state.ny.us</p>
                            )}
                          </div>
                        )}
                        <p className="text-xs text-slate-400">Verify at: <strong>iapps.courts.state.ny.us/webcivil/FCASMain</strong></p>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Strategy reasoning */}
              {a?.strategyReasoning && (
                <div className="p-4 rounded-lg border border-blue-100 bg-blue-50">
                  <div className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-1.5">Strategy Recommendation</div>
                  <p className="text-xs text-blue-800 leading-relaxed">{a.strategyReasoning}</p>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Strategy Selector */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Select Strategy</div>
          {needsAnalysis && (
            <span className="text-xs text-slate-400 italic">Run AI analysis above to get a recommendation</span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-4">
          {strategies.map((s) => {
            const isSelected = caseData.strategy === s.id;
            const isRecommended = caseData.caseAssessment?.recommendedStrategy === s.id;
            const isGeneric = needsAnalysis && !isSelected;
            return (
              <button
                key={s.id}
                onClick={() => strategyMutation.mutate(s.id)}
                disabled={strategyMutation.isPending}
                className={`card p-5 text-left transition-all relative ${
                  isSelected
                    ? 'border-blue-500 ring-2 ring-blue-200 bg-blue-50/50'
                    : isGeneric
                    ? 'opacity-50 hover:opacity-70 hover:border-slate-300'
                    : 'hover:border-slate-300'
                }`}
              >
                {isRecommended && !isSelected && (
                  <span className="absolute top-2 right-2 text-xs font-semibold text-purple-600 bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded-full">AI pick</span>
                )}
                <div className="text-sm font-semibold text-slate-800 mb-2 pr-16">{s.title}</div>
                <p className="text-xs text-slate-500 mb-3 leading-relaxed">{s.description}</p>
                <div className="space-y-1">
                  {s.traits.map((t) => (
                    <div key={t} className="text-xs text-slate-400 flex items-center gap-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-blue-500' : 'bg-slate-300'}`} />
                      {t}
                    </div>
                  ))}
                </div>
                {isSelected && (
                  <div className="mt-3 text-xs font-semibold text-blue-600 uppercase tracking-wider">Selected</div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Demand Letter Tab ─────────────────────────────────────────────────────────

function LetterTab({ caseData }: { caseData: Case }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const generateMutation = useMutation({
    mutationFn: () => generateLetter(caseData.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });

  const isGenerating = caseData.status === 'GENERATING' || generateMutation.isPending;

  const handleCopy = () => {
    if (caseData.demandLetter) {
      navigator.clipboard.writeText(caseData.demandLetter);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleEmail = async () => {
    if (!caseData.debtorEmail) return;
    const subject = encodeURIComponent(`Demand for Payment — ${caseData.debtorBusiness || caseData.debtorName || 'Outstanding Balance'}`);
    const body = encodeURIComponent(caseData.demandLetter || '');
    window.open(`mailto:${caseData.debtorEmail}?subject=${subject}&body=${body}`);
    try {
      await logAction(caseData.id, 'EMAIL_SENT', `Demand letter emailed to ${caseData.debtorEmail}`);
      queryClient.invalidateQueries({ queryKey: ['case', caseData.id] });
    } catch { /* non-blocking */ }
  };

  if (!caseData.demandLetterHtml && !isGenerating) {
    return (
      <div className="card p-8 text-center">
        <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <div className="text-sm font-semibold text-slate-800 mb-1">Generate Demand Letter</div>
        <p className="text-sm text-slate-500 mb-4 max-w-md mx-auto">
          {caseData.strategy
            ? 'Generate a professional demand letter based on your case details and selected strategy.'
            : 'Select a strategy first, then generate your demand letter.'}
        </p>
        <button
          onClick={() => generateMutation.mutate()}
          disabled={!caseData.strategy || generateMutation.isPending}
          className="btn-primary"
        >
          Generate Letter
        </button>
      </div>
    );
  }

  if (isGenerating) {
    return <RotatingFact label="Generating demand letter..." sublabel="This usually takes 20–40 seconds." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={handleCopy} className="btn-secondary text-sm flex items-center gap-2">
          <Copy className="w-4 h-4" /> {copied ? 'Copied!' : 'Copy Text'}
        </button>
        {caseData.debtorEmail ? (
          <button onClick={handleEmail} className="btn-secondary text-sm flex items-center gap-2">
            <Mail className="w-4 h-4" /> Email to Debtor
          </button>
        ) : (
          <span className="text-xs text-slate-400">No debtor email on file — add one in Overview to enable email.</span>
        )}
        <button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          className="btn-secondary text-sm ml-auto"
        >
          Regenerate
        </button>
      </div>
      <div className="card p-8">
        <div
          className="prose prose-sm max-w-none prose-slate"
          dangerouslySetInnerHTML={{ __html: caseData.demandLetterHtml || '' }}
        />
      </div>
    </div>
  );
}

// ─── Escalation Tab ────────────────────────────────────────────────────────────

function EscalationTab({ caseData }: { caseData: Case }) {
  const queryClient = useQueryClient();
  const [copiedFN, setCopiedFN] = useState(false);
  const [showProcessServerModal, setShowProcessServerModal] = useState(false);
  const [serviceNotes, setServiceNotes] = useState('');
  const [serviceLogging, setServiceLogging] = useState(false);

  const outstanding = parseFloat(caseData.amountOwed || '0') - parseFloat(caseData.amountPaid || '0');
  const courtTrack = outstanding <= 10000 ? 'commercial' : outstanding <= 50000 ? 'civil' : 'supreme';
  const courtFormName = courtTrack === 'commercial'
    ? 'Commercial Claims Court — CIV-SC-70'
    : courtTrack === 'civil'
    ? 'NYC Civil Court — Pro Se Summons & Complaint'
    : 'Supreme Court — Summons with Notice';

  const finalNoticeMutation = useMutation({
    mutationFn: () => generateFinalNotice(caseData.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });

  const courtFormMutation = useMutation({
    mutationFn: () => generateCourtForm(caseData.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });

  const defaultJudgmentMutation = useMutation({
    mutationFn: () => generateDefaultJudgment(caseData.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });

  const handleCopyFN = () => {
    if (caseData.finalNotice) {
      navigator.clipboard.writeText(caseData.finalNotice);
      setCopiedFN(true);
      setTimeout(() => setCopiedFN(false), 2000);
    }
  };

  const handleEmailFN = async () => {
    if (!caseData.debtorEmail || !caseData.finalNotice) return;
    const subject = encodeURIComponent(`Final Notice — ${caseData.debtorBusiness || caseData.debtorName || 'Outstanding Balance'}`);
    const body = encodeURIComponent(caseData.finalNotice);
    window.open(`mailto:${caseData.debtorEmail}?subject=${subject}&body=${body}`);
    try {
      await logAction(caseData.id, 'EMAIL_SENT', `Final notice emailed to ${caseData.debtorEmail}`);
      queryClient.invalidateQueries({ queryKey: ['case', caseData.id] });
    } catch { /* non-blocking */ }
  };

  const handlePrintCourtForm = () => {
    const html = caseData.filingPacketHtml;
    if (!html) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><title>Court Form</title><style>
      @media print { body { margin: 1in; } }
      body { font-family: serif; max-width: 750px; margin: 0 auto; padding: 2rem; }
    </style></head><body>${html}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  const handleLogServiceInitiated = async () => {
    setServiceLogging(true);
    try {
      await logAction(
        caseData.id,
        'SERVICE_INITIATED',
        serviceNotes || `Process server engagement initiated. Defendant address: ${caseData.debtorAddress || '[unknown]'}`,
        { debtorAddress: caseData.debtorAddress, notes: serviceNotes }
      );
      await queryClient.invalidateQueries({ queryKey: ['case', caseData.id] });
      setShowProcessServerModal(false);
      setServiceNotes('');
    } finally {
      setServiceLogging(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Section 1: Pre-Filing Notice */}
      <div>
        <h3 className="text-sm font-semibold text-slate-800 mb-1 flex items-center gap-2">
          <Shield className="w-4 h-4 text-red-500" /> Pre-Filing Notice
        </h3>
        <p className="text-xs text-slate-500 mb-4">Send this before filing to give the debtor a final opportunity to pay and to document your escalation path.</p>
        {finalNoticeMutation.isPending ? (
          <RotatingFact label="Generating pre-filing notice..." sublabel="This usually takes 15–25 seconds." />
        ) : caseData.finalNoticeHtml ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <button onClick={handleCopyFN} className="btn-secondary text-sm flex items-center gap-2">
                <Copy className="w-4 h-4" /> {copiedFN ? 'Copied!' : 'Copy Text'}
              </button>
              {caseData.debtorEmail ? (
                <button onClick={handleEmailFN} className="btn-secondary text-sm flex items-center gap-2">
                  <Mail className="w-4 h-4" /> Email to Debtor
                </button>
              ) : (
                <span className="text-xs text-slate-400">No debtor email on file.</span>
              )}
              <button
                onClick={() => finalNoticeMutation.mutate()}
                className="btn-secondary text-sm ml-auto"
              >
                Regenerate
              </button>
            </div>
            <div className="card p-8">
              <div
                className="prose prose-sm max-w-none prose-slate"
                dangerouslySetInnerHTML={{ __html: caseData.finalNoticeHtml }}
              />
            </div>
          </div>
        ) : (
          <div className="card p-6 text-center">
            <p className="text-sm text-slate-500 mb-4">
              Generate a pre-filing notice — a short, firm letter stating legal action is imminent.
            </p>
            <button
              onClick={() => finalNoticeMutation.mutate()}
              className="btn-primary"
            >
              Generate Pre-Filing Notice
            </button>
          </div>
        )}
      </div>

      {/* Section 2: Court Form */}
      <div>
        <h3 className="text-sm font-semibold text-slate-800 mb-1 flex items-center gap-2">
          <Scale className="w-4 h-4 text-blue-600" /> Court Form — {caseData.courtFormType || courtFormName}
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          Based on your outstanding balance of <span className="font-semibold">${outstanding.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>, the applicable form is: <span className="font-semibold">{courtFormName}</span>.
        </p>

        {/* Warning banner */}
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 mb-4">
          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <span>This form will be pre-filled with your case data. <strong>Review every field carefully before filing.</strong> Use [UNKNOWN — VERIFY BEFORE FILING] placeholders where data is missing.</span>
        </div>

        {courtFormMutation.isPending ? (
          <RotatingFact label="Generating court form..." sublabel="Running generate → verify → correct pipeline. This takes 45–90 seconds." />
        ) : caseData.filingPacketHtml ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={handlePrintCourtForm}
                className="btn-primary text-sm flex items-center gap-2"
              >
                <FileText className="w-4 h-4" /> Print Form
              </button>
              <button
                onClick={() => courtFormMutation.mutate()}
                className="btn-secondary text-sm"
              >
                Regenerate
              </button>
            </div>

            {/* Verification panel */}
            {caseData.courtFormVerification && (() => {
              const v = caseData.courtFormVerification!;
              const statusConfig = {
                verified: { bg: 'bg-emerald-50 border-emerald-200', badge: 'bg-emerald-100 text-emerald-800', icon: '✓', label: 'Verified' },
                review_needed: { bg: 'bg-amber-50 border-amber-200', badge: 'bg-amber-100 text-amber-800', icon: '⚠', label: 'Review Needed' },
                issues_found: { bg: 'bg-red-50 border-red-200', badge: 'bg-red-100 text-red-800', icon: '✗', label: 'Issues Found' },
              }[v.overallStatus];
              const checkIcon = { ok: '✓', missing: '○', mismatch: '✗', hallucinated: '!' };
              const checkColor = { ok: 'text-emerald-600', missing: 'text-amber-500', mismatch: 'text-red-600', hallucinated: 'text-red-700 font-bold' };
              const issues = v.checks.filter(c => c.status !== 'ok');
              const okCount = v.checks.filter(c => c.status === 'ok').length;
              return (
                <div className={`card p-5 border ${statusConfig.bg}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider">AI Verification Report</div>
                      {v.didRetry && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">Auto-corrected</span>
                      )}
                    </div>
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${statusConfig.badge}`}>
                      {statusConfig.icon} {statusConfig.label}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 mb-4">{v.summary}</p>
                  <div className="flex gap-4 text-xs text-slate-500 mb-4">
                    <span><span className="font-semibold text-emerald-600">{okCount}</span> verified</span>
                    <span><span className="font-semibold text-amber-500">{v.checks.filter(c => c.status === 'missing').length}</span> missing</span>
                    <span><span className="font-semibold text-red-600">{v.checks.filter(c => c.status === 'mismatch' || c.status === 'hallucinated').length}</span> errors</span>
                  </div>
                  {issues.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {issues.map((check, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm">
                          <span className={`shrink-0 font-bold w-4 text-center ${checkColor[check.status]}`}>{checkIcon[check.status]}</span>
                          <div className="flex-1 min-w-0">
                            <span className="font-medium text-slate-700">{check.field}</span>
                            {check.note && <span className="text-slate-500"> — {check.note}</span>}
                            {(check.expected || check.found) && (
                              <div className="text-xs text-slate-400 mt-0.5">
                                {check.expected && <span>Expected: <span className="text-slate-600">{check.expected}</span></span>}
                                {check.found && check.status !== 'ok' && <span className="ml-3">Found: <span className="text-slate-600">{check.found}</span></span>}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {v.blankFields.length > 0 && (
                    <div className="text-xs text-slate-500 border-t border-black/5 pt-3">
                      <span className="font-semibold">Blank / UNKNOWN fields:</span> {v.blankFields.join(', ')}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Instructions list */}
            {caseData.courtFormInstructions && caseData.courtFormInstructions.length > 0 && (
              <div className="card p-5 bg-blue-50 border-blue-100">
                <div className="text-xs font-semibold text-blue-700 uppercase tracking-wider mb-3">Next Steps</div>
                <ol className="space-y-2">
                  {caseData.courtFormInstructions.map((step, i) => (
                    <li key={i} className="flex gap-2 text-sm text-blue-900">
                      <span className="font-bold text-blue-400 shrink-0">{i + 1}.</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <div className="card p-8">
              <div
                className="prose prose-sm max-w-none prose-slate"
                dangerouslySetInnerHTML={{ __html: caseData.filingPacketHtml }}
              />
            </div>
          </div>
        ) : (
          <div className="card p-6 text-center">
            <div className="text-sm font-semibold text-slate-700 mb-2">{courtFormName}</div>
            <p className="text-sm text-slate-500 mb-4">
              Generate a pre-filled, print-ready version of the correct NYC court form for your case.
            </p>
            <button
              onClick={() => courtFormMutation.mutate()}
              className="btn-primary"
            >
              Generate Pre-Filled Court Form
            </button>
          </div>
        )}
      </div>

      {/* Section 3: Process Server Engagement */}
      {(courtTrack === 'civil' || courtTrack === 'supreme') && (
        <div>
          <h3 className="text-sm font-semibold text-slate-800 mb-1 flex items-center gap-2">
            <Send className="w-4 h-4 text-violet-500" /> Process Server Engagement
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            For Civil Court and Supreme Court cases, a licensed process server must serve the summons. Log when service is initiated.
          </p>
          <div className="card p-5">
            <div className="grid grid-cols-2 gap-4 text-sm mb-4">
              <div>
                <div className="text-xs text-slate-500 mb-1">Defendant</div>
                <div className="font-medium text-slate-800">{caseData.debtorBusiness || caseData.debtorName || '[unknown]'}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Address</div>
                <div className="font-medium text-slate-800">{caseData.debtorAddress || '[unknown — required for service]'}</div>
              </div>
            </div>
            {(() => {
              const svcAction = caseData.actions.find(a => a.type === 'SERVICE_INITIATED');
              if (!svcAction) {
                return (
                  <button
                    onClick={() => setShowProcessServerModal(true)}
                    className="btn-secondary text-sm"
                  >
                    Log Service Initiated
                  </button>
                );
              }
              const svcDate = new Date(svcAction.createdAt);
              const personalDeadline = new Date(svcDate);
              personalDeadline.setDate(personalDeadline.getDate() + 20);
              const altDeadline = new Date(svcDate);
              altDeadline.setDate(altDeadline.getDate() + 30);
              const defaultDate = new Date(altDeadline);
              defaultDate.setDate(defaultDate.getDate() + 1);
              const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              const today = new Date();
              const personalDaysLeft = Math.ceil((personalDeadline.getTime() - today.getTime()) / 86400000);
              const altDaysLeft = Math.ceil((altDeadline.getTime() - today.getTime()) / 86400000);
              return (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 rounded-lg px-4 py-2">
                    <CheckCircle className="w-4 h-4 shrink-0" />
                    <span>Service initiated {fmt(svcDate)} — deadlines calculated below.</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Answer deadline (personal service)', date: personalDeadline, days: personalDaysLeft, note: 'CPLR: 20 days' },
                      { label: 'Answer deadline (other service)', date: altDeadline, days: altDaysLeft, note: 'CPLR: 30 days' },
                      { label: 'Default motion date', date: defaultDate, days: altDaysLeft + 1, note: 'Day after answer deadline' },
                    ].map(({ label, date, days, note }) => {
                      const isPast = days < 0;
                      const isUrgent = days >= 0 && days <= 7;
                      const color = isPast ? 'border-red-200 bg-red-50' : isUrgent ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50';
                      const textColor = isPast ? 'text-red-700' : isUrgent ? 'text-amber-700' : 'text-slate-700';
                      return (
                        <div key={label} className={`p-3 rounded-lg border ${color}`}>
                          <div className="text-xs text-slate-500 leading-tight mb-1">{label}</div>
                          <div className={`text-sm font-semibold ${textColor}`}>{fmt(date)}</div>
                          <div className="text-xs text-slate-400 mt-0.5">{note}</div>
                          {isPast && <div className="text-xs font-bold text-red-600 mt-0.5">PASSED</div>}
                          {isUrgent && !isPast && <div className="text-xs font-bold text-amber-600 mt-0.5">{days}d left</div>}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">Calendar these immediately. If the defendant does not appear or answer by the applicable deadline, you may move for default judgment.</p>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Section 4: Default Judgment Motion */}
      <div>
        <h3 className="text-sm font-semibold text-slate-800 mb-1 flex items-center gap-2">
          <Scale className="w-4 h-4 text-slate-500" /> Default Judgment Motion
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          If the defendant was served but failed to appear or answer within the required deadline (20 days after personal service, 30 days after alternative service), you can move for a default judgment.
        </p>
        {defaultJudgmentMutation.isPending ? (
          <RotatingFact label="Generating default judgment motion..." sublabel="This usually takes 20–40 seconds." />
        ) : caseData.defaultJudgmentHtml ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  const w = window.open('', '_blank');
                  if (!w || !caseData.defaultJudgmentHtml) return;
                  w.document.write(`<!DOCTYPE html><html><head><title>Default Judgment Motion</title><style>
                    @media print { body { margin: 1in; } }
                    body { font-family: serif; max-width: 750px; margin: 0 auto; padding: 2rem; }
                  </style></head><body>${caseData.defaultJudgmentHtml}</body></html>`);
                  w.document.close();
                  w.focus();
                  w.print();
                }}
                className="btn-primary text-sm flex items-center gap-2"
              >
                <FileText className="w-4 h-4" /> Print Motion
              </button>
              <button
                onClick={() => defaultJudgmentMutation.mutate()}
                className="btn-secondary text-sm ml-auto"
              >
                Regenerate
              </button>
            </div>
            <div className="card p-8">
              <div
                className="prose prose-sm max-w-none prose-slate"
                dangerouslySetInnerHTML={{ __html: caseData.defaultJudgmentHtml }}
              />
            </div>
          </div>
        ) : (
          <div className="card p-6 text-center">
            <p className="text-sm text-slate-500 mb-4">
              Generate a Motion for Default Judgment package — Notice of Motion, Affidavit in Support, Proposed Order, and blank Affidavit of Service template.
            </p>
            <button
              onClick={() => defaultJudgmentMutation.mutate()}
              className="btn-primary"
            >
              Generate Default Judgment Motion
            </button>
          </div>
        )}
      </div>

      {/* Process Server Modal */}
      {showProcessServerModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-slate-900">Log Service Initiated</h3>
              <button onClick={() => setShowProcessServerModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 rounded-lg text-sm">
                <div className="text-xs text-slate-500 mb-1">Serving</div>
                <div className="font-semibold text-slate-800">{caseData.debtorBusiness || caseData.debtorName || '[unknown defendant]'}</div>
                <div className="text-slate-600 mt-1">{caseData.debtorAddress || '[address unknown — update case before proceeding]'}</div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Notes (optional)</label>
                <textarea
                  value={serviceNotes}
                  onChange={(e) => setServiceNotes(e.target.value)}
                  placeholder="Process server name, instructions, date engaged..."
                  className="input w-full h-24 text-sm resize-none"
                />
              </div>
              <div className="p-3 bg-blue-50 rounded-lg text-xs text-blue-800">
                This logs a SERVICE_INITIATED action in the case timeline. The process server is responsible for completing service and providing an Affidavit of Service.
              </div>
              <div className="flex justify-end gap-3">
                <button onClick={() => setShowProcessServerModal(false)} className="btn-secondary text-sm">
                  Cancel
                </button>
                <button
                  onClick={handleLogServiceInitiated}
                  disabled={serviceLogging}
                  className="btn-primary text-sm flex items-center gap-2"
                >
                  {serviceLogging && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirm — Log Service Initiated
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── NY Filing Guide Tab ───────────────────────────────────────────────────────

type CourtTrack = 'commercial' | 'civil' | 'supreme';

function ExpandableItem({ label, children, num }: { label: string; children: React.ReactNode; num?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border border-slate-100 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-50 transition-colors"
      >
        {num !== undefined && (
          <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-xs font-bold shrink-0">
            {num}
          </span>
        )}
        <span className="text-sm text-slate-700 flex-1 leading-snug font-medium">{label}</span>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />}
      </button>
      {open && <div className="px-4 pb-4 pt-2 border-t border-slate-100 space-y-2">{children}</div>}
    </li>
  );
}

function FilingGuideTab({ caseData }: { caseData: Case }) {
  const outstanding = parseFloat(caseData.amountOwed || '0') - parseFloat(caseData.amountPaid || '0');

  const track: CourtTrack = outstanding <= 10000 ? 'commercial' : outstanding <= 50000 ? 'civil' : 'supreme';

  const courtInfo = {
    commercial: {
      name: 'NYC Commercial Claims Court',
      range: 'Up to $10,000',
      fee: '$25 + postage',
      rep: 'No attorney required',
      highlight: 'bg-green-50 border-green-200',
      badge: 'text-green-700 bg-green-100',
      note: 'Best for a clean B2B money claim by a corporation, LLC, or partnership. The court handles notice to the defendant — no process server required. Filing cap: 5 actions per month per claimant.',
    },
    civil: {
      name: 'NYC Civil Court — General Civil Part',
      range: '$10,001–$50,000',
      fee: '~$45',
      rep: 'Attorney recommended',
      highlight: 'bg-amber-50 border-amber-200',
      badge: 'text-amber-700 bg-amber-100',
      note: 'Standard civil case structure. You file a summons and complaint, serve via process server, and proceed through the formal civil track.',
    },
    supreme: {
      name: 'NY Supreme Court',
      range: 'Above $50,000',
      fee: '$210 (index number)',
      rep: 'Attorney strongly recommended',
      highlight: 'bg-red-50 border-red-200',
      badge: 'text-red-700 bg-red-100',
      note: 'Full formal litigation. File in the county where the defendant does business. Discovery applies. E-filing is mandatory for represented parties in most NYC counties.',
    },
  }[track];

  const p = (text: string) => <p className="text-sm text-slate-600 leading-relaxed">{text}</p>;
  const sub = (text: string) => <p className="text-xs text-slate-500 leading-relaxed">{text}</p>;
  const warn = (text: string) => <p className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">{text}</p>;
  const ok = (text: string) => <p className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">{text}</p>;
  const steps = (items: string[]) => (
    <ol className="space-y-2 mt-1">
      {items.map((s, i) => (
        <li key={i} className="flex gap-2 text-sm text-slate-600">
          <span className="text-slate-400 font-semibold shrink-0">{i + 1}.</span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="space-y-6">

      {/* Court Routing Card */}
      <div className={`card p-6 ${courtInfo.highlight}`}>
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <div className="text-lg font-bold text-slate-900">{courtInfo.name}</div>
            <p className="text-sm text-slate-600 mt-1 leading-relaxed">{courtInfo.note}</p>
          </div>
          <span className={`text-xs font-semibold px-3 py-1 rounded-full shrink-0 ${courtInfo.badge}`}>
            {formatCurrency(outstanding)} outstanding
          </span>
        </div>
        <div className="flex flex-wrap gap-6 mt-4 text-sm border-t border-black/5 pt-4">
          <div><span className="text-slate-500">Filing Fee:</span> <span className="font-semibold text-slate-800">{courtInfo.fee}</span></div>
          <div><span className="text-slate-500">Representation:</span> <span className="font-semibold text-slate-800">{courtInfo.rep}</span></div>
          <div><span className="text-slate-500">Claim Range:</span> <span className="font-semibold text-slate-800">{courtInfo.range}</span></div>
        </div>
        {/* SOL inline */}
        {(() => {
          const sol = computeSOL(caseData.paymentDueDate);
          if (sol.status === 'unknown') return null;
          const solStyle = { ok: 'text-emerald-800', warning: 'text-amber-800', urgent: 'text-red-800 font-semibold', expired: 'text-red-900 font-bold', unknown: '' }[sol.status];
          return (
            <div className={`mt-3 pt-3 border-t border-black/5 text-xs ${solStyle}`}>
              SOL (CPLR §213): {sol.label}
            </div>
          );
        })()}
      </div>

      {/* Court Thresholds Reference */}
      <div className="card p-5">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">NYC Court Thresholds</div>
        <div className="grid grid-cols-3 gap-3">
          {([
            { key: 'commercial', label: 'Commercial Claims', range: '≤ $10,000', fee: '$25 + postage', note: 'Corp/LLC/partnership, no attorney' },
            { key: 'civil', label: 'Civil Court', range: '$10,001–$50,000', fee: '~$45', note: 'Summons + complaint, process server' },
            { key: 'supreme', label: 'Supreme Court', range: '> $50,000', fee: '$210+', note: 'Full litigation, attorney recommended' },
          ] as const).map((c) => (
            <div key={c.key} className={`p-4 rounded-lg border transition-all ${track === c.key ? 'border-blue-300 bg-blue-50' : 'border-slate-100'}`}>
              <div className="text-sm font-semibold text-slate-800">{c.label}</div>
              <div className="text-xs text-slate-500 mt-1">{c.range}</div>
              <div className="text-xs text-slate-400 mt-0.5">Fee: {c.fee}</div>
              <div className="text-xs text-slate-400 mt-1 leading-tight">{c.note}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Pre-Filing Checklist */}
      <div className="card p-5">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Pre-Filing Checklist</div>
        <ul className="space-y-2">
          {([
            { label: 'Exact legal name of your company (as registered)', done: !!(caseData.claimantBusiness || caseData.claimantName) },
            { label: 'Exact legal name and address of the defendant', done: !!(caseData.debtorBusiness || caseData.debtorName) },
            { label: 'Contract, proposal, or statement of work', done: caseData.documents.some(d => d.classification === 'contract') },
            { label: 'Invoice(s) with payment terms and due date', done: caseData.documents.some(d => d.classification === 'invoice') },
            { label: 'Proof of work performed / delivered', done: caseData.documents.some(d => d.classification === 'proof_of_work') },
            { label: 'Emails or messages showing the deal or non-payment', done: caseData.documents.some(d => d.classification === 'communication') },
            { label: 'Demand letter sent (required for Commercial Claims)', done: !!caseData.demandLetter },
            { label: 'One-page chronology of events', done: !!(caseData.caseTimeline && (caseData.caseTimeline as unknown[]).length > 0) },
          ]).map(({ label, done }, i) => (
            <li key={i} className={`flex items-start gap-2.5 text-sm ${done ? 'text-slate-700' : 'text-slate-400'}`}>
              <CheckCircle className={`w-4 h-4 mt-0.5 shrink-0 ${done ? 'text-emerald-500' : 'text-slate-200'}`} />
              <span>{label}</span>
            </li>
          ))}
        </ul>
        {caseData.documents.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="text-xs font-semibold text-slate-500 mb-2">Documents in this case:</div>
            <div className="flex flex-wrap gap-2">
              {caseData.documents.map((doc) => (
                <span key={doc.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full text-xs">
                  <FileText className="w-3 h-3 shrink-0" />
                  {doc.originalName}
                  {doc.classification && <span className="text-slate-400">· {DOC_CLASSIFICATION_LABELS[doc.classification] || doc.classification}</span>}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Step-by-step for selected track */}
      <div className="card p-5">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
          Filing Steps — {courtInfo.name}
        </div>
        <ol className="space-y-2">
          {track === 'commercial' && (
            <>
              <ExpandableItem num={1} label="Send a pre-suit demand letter (required)">
                {p('For Commercial Claims, New York requires you to send a demand letter at least 10 days — and no more than 180 days — before filing. This is a real precondition, not optional.')}
                {caseData.demandLetter ? ok('✓ Demand letter generated in this case. Keep proof of delivery.') : warn('⚠ No demand letter yet. Go to the Demand Letter tab to generate one before filing.')}
                {sub('Keep proof of sending: certified mail receipt, delivery confirmation, or email with read receipt.')}
              </ExpandableItem>
              <ExpandableItem num={2} label="Verify the defendant's exact legal name and address">
                {p('Commercial Claims must be brought in the county where the defendant lives, works, or has a place of business. If you are unsure of the correct business name, check NYS entity records or County Clerk records for assumed names.')}
              </ExpandableItem>
              <ExpandableItem num={3} label="Go to the Commercial Claims office in the correct county">
                {p('Bring: your company information, defendant\'s exact legal name and address, amount owed, a short description of the claim, and proof you sent the demand letter.')}
                {sub('Filing cap: you may begin no more than 5 Commercial Claims actions per month.')}
              </ExpandableItem>
              <ExpandableItem num={4} label="Fill out the Statement of Claim and pay the filing fee">
                {p('The fee is $25 plus postage. Staff will assist with the form. The court handles notice to the defendant under the Commercial Claims process — you do not need to hire a process server.')}
              </ExpandableItem>
              <ExpandableItem num={5} label="Attend the hearing">
                {p('Bring originals and copies of all evidence. Present clearly and factually. If the defendant does not appear after proper notice, you can request a default judgment.')}
              </ExpandableItem>
            </>
          )}

          {track === 'civil' && (
            <>
              <ExpandableItem num={1} label="Send a demand letter and document it">
                {p('While not a strict statutory precondition for Civil Court (unlike Commercial Claims), courts and opposing parties expect to see a pre-suit demand. It also strengthens your position.')}
                {caseData.demandLetter ? ok('✓ Demand letter generated. Keep proof of delivery.') : warn('⚠ No demand letter yet — generate one in the Demand Letter tab.')}
              </ExpandableItem>
              <ExpandableItem num={2} label="Prepare your Summons and Complaint">
                {p('Draft a summons and complaint that clearly states: who the parties are, what was agreed, what you provided, how much is owed, when payment was due, and what relief you want.')}
                {p('For a B2B unpaid invoice, common causes of action include breach of contract, account stated, and unjust enrichment / quantum meruit if there is no signed contract.')}
              </ExpandableItem>
              <ExpandableItem num={3} label="File with the NYC Civil Court clerk">
                {p('File in the borough/county where the defendant is located. Bring 3 copies. Pay the ~$45 fee. The clerk stamps your copies and issues the summons.')}
                {sub('If self-represented, ask the clerk for an Application for a Pro Se Summons, or use your own summons form.')}
              </ExpandableItem>
              <ExpandableItem num={4} label="Serve the defendant via process server (within 120 days)">
                {p('Hire a licensed process server to deliver the summons and complaint. The server must physically hand it to the defendant or leave it at their place of business per NY service rules.')}
                {p('Get a notarized Affidavit of Service from the process server immediately after service.')}
              </ExpandableItem>
              <ExpandableItem num={5} label="File the Affidavit of Service">
                {p('File the completed, notarized affidavit with the court clerk promptly after service. This is required — do not skip it.')}
              </ExpandableItem>
              <ExpandableItem num={6} label="Calendar the defendant's response deadline">
                {p('The defendant generally has 20 days to respond after personal service, or 30 days after service is completed by other authorized means. Mark this date immediately.')}
                {p('If they do not respond, you can move for a default judgment. If they respond, the case proceeds to discovery and a hearing/trial date.')}
              </ExpandableItem>
            </>
          )}

          {track === 'supreme' && (
            <>
              <ExpandableItem num={1} label="Retain a NY-licensed attorney">
                {p('Supreme Court filings are complex. While self-representation is technically allowed, it is not recommended for claims of this size. An attorney will draft the papers, manage deadlines, and handle discovery.')}
              </ExpandableItem>
              <ExpandableItem num={2} label="Draft a Summons and Complaint (or Summons with Notice)">
                {p('Your attorney will prepare either a Summons and Complaint or a Summons with Notice. The complaint should plead: parties, the agreement, your performance, the unpaid amount, the due date, non-payment, and the relief requested.')}
                {p('Causes of action for B2B unpaid invoices typically include breach of contract, account stated, and quantum meruit / unjust enrichment.')}
              </ExpandableItem>
              <ExpandableItem num={3} label="Purchase an index number and file">
                {p('File with the County Clerk in the county where the defendant does business. Pay the $210 index number fee. In New York County and most NYC Supreme Courts, e-filing is mandatory for represented parties (NYSCEF). Unrepresented parties are automatically exempt unless they opt in.')}
              </ExpandableItem>
              <ExpandableItem num={4} label="Serve the defendant within 120 days">
                {p('A summons with notice or summons and complaint must be served within 120 days of filing. Use a licensed process server. Personal service on the defendant\'s registered agent or an officer of the entity is standard for business defendants.')}
              </ExpandableItem>
              <ExpandableItem num={5} label="File the notarized Affidavit of Service">
                {p('File the completed affidavit promptly after service. Calendar the answer deadline (20 days after personal service, 30 days after alternative service). Set a tickler for the default date.')}
              </ExpandableItem>
              <ExpandableItem num={6} label="Discovery phase">
                {p('If the defendant answers, the case proceeds to discovery: document requests, interrogatories, and potentially depositions. A preliminary conference is usually scheduled by the court.')}
              </ExpandableItem>
            </>
          )}
        </ol>
      </div>

      {/* How a serious lawyer handles service */}
      <div className="card p-5">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">How to Handle Service Properly</div>
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
      </div>

      {/* Deadline tracker — computed from case data */}
      {(() => {
        const demandSentAction = caseData.actions.find(a => a.type === 'EMAIL_SENT' || a.type === 'CERTIFIED_MAIL_SENT' || a.type === 'DEMAND_LETTER_GENERATED');
        const svcAction = caseData.actions.find(a => a.type === 'SERVICE_INITIATED');
        const svcDate = svcAction ? new Date(svcAction.createdAt) : null;
        const personalAnswerDue = svcDate ? new Date(new Date(svcDate).setDate(svcDate.getDate() + 20)) : null;
        const altAnswerDue = svcDate ? new Date(new Date(svcDate).setDate(svcDate.getDate() + 30)) : null;
        const defaultMotionDate = altAnswerDue ? new Date(new Date(altAnswerDue).setDate(altAnswerDue.getDate() + 1)) : null;
        const fmt = (d: Date | null) => d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
        const today = new Date();
        const daysLeft = (d: Date | null) => d ? Math.ceil((d.getTime() - today.getTime()) / 86400000) : null;

        const deadlines = [
          { label: 'Demand letter sent', value: demandSentAction ? formatDate(demandSentAction.createdAt) : null, note: 'Required for Commercial Claims (10+ days before filing)' },
          { label: 'Claim filed', value: null, note: 'Record date you file at the courthouse' },
          { label: 'Service completed', value: svcDate ? fmt(svcDate) : null, note: 'Must occur within 120 days of filing' },
          { label: 'Affidavit of service filed', value: null, note: 'File promptly after service — do not wait' },
          { label: 'Answer due (personal service)', value: fmt(personalAnswerDue), days: daysLeft(personalAnswerDue), note: '20 days from personal service (CPLR)' },
          { label: 'Answer due (other service)', value: fmt(altAnswerDue), days: daysLeft(altAnswerDue), note: '30 days from completed service (CPLR)' },
          { label: 'Default motion eligible', value: fmt(defaultMotionDate), days: daysLeft(defaultMotionDate), note: 'Day after answer deadline passes' },
          { label: 'RJI deadline (Supreme Court)', value: null, note: '60 days from first filing (Supreme Court only)' },
        ];

        return (
          <div className="card p-5">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Case Deadline Tracker</div>
            <div className="space-y-2">
              {deadlines.map(({ label, value, days, note }, i) => {
                const isPast = days != null && days < 0;
                const isUrgent = days != null && days >= 0 && days <= 14;
                const hasDays = days != null;
                return (
                  <div key={i} className={`flex items-start gap-3 p-2.5 rounded-lg ${isPast ? 'bg-red-50 border border-red-100' : value ? 'bg-emerald-50 border border-emerald-100' : 'bg-slate-50 border border-transparent'}`}>
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${isPast ? 'bg-red-400' : value ? 'bg-emerald-400' : 'bg-slate-300'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className={`text-xs font-medium ${isPast ? 'text-red-700' : value ? 'text-emerald-800' : 'text-slate-600'}`}>{label}</span>
                        {value && <span className={`text-xs font-semibold ml-auto shrink-0 ${isPast ? 'text-red-700' : isUrgent ? 'text-amber-700' : 'text-slate-700'}`}>{value}{hasDays && days! >= 0 ? ` (${days}d)` : isPast ? ' (PASSED)' : ''}</span>}
                        {!value && <span className="text-xs text-slate-300 ml-auto shrink-0">—</span>}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">{note}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            {!svcAction && (
              <p className="text-xs text-slate-400 mt-3 pt-3 border-t border-slate-100">Log "Service Initiated" in the Escalation tab to calculate answer and default deadlines automatically.</p>
            )}
          </div>
        );
      })()}

      {/* Common mistakes */}
      <div className="card p-5 border-red-100">
        <div className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-3">Common Mistakes to Avoid</div>
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
      </div>

      {/* Judgment enforcement */}
      <div className="card p-5">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Enforcing a Judgment</div>
        <p className="text-sm text-slate-600 mb-3">Winning in court gives you a judgment — a legal right to collect. The court does not collect for you. Three main enforcement tools:</p>
        <div className="space-y-2">
          {[
            {
              title: 'Bank Levy',
              body: 'Instruct a city marshal or sheriff to freeze and seize funds from the debtor\'s bank account. You may need to identify the bank through post-judgment disclosure proceedings (a court-ordered deposition about the debtor\'s assets).',
            },
            {
              title: 'Property Lien',
              body: 'File a lien against real property the debtor owns in New York. They cannot sell or refinance the property without satisfying your judgment first. File with the county clerk where the property is located.',
            },
            {
              title: 'Income Execution (Wage Garnishment)',
              body: 'If the debtor is an individual with employment income, you can garnish up to 10% of gross wages in NY. A marshal serves the employer, who withholds the amount and remits it to you. Does not apply to business entity defendants — use bank levy instead.',
            },
          ].map(({ title, body }) => (
            <div key={title} className="p-3 bg-slate-50 rounded-lg">
              <div className="text-sm font-semibold text-slate-800 mb-1">{title}</div>
              <p className="text-xs text-slate-600 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* NYC City Marshal Directory */}
      <div className="card p-5">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">NYC City Marshals — Judgment Enforcement</div>
        <p className="text-xs text-slate-500 mb-4 leading-relaxed">
          Once you have a judgment, a NYC City Marshal can levy bank accounts, seize business property, and execute income executions on behalf of judgment creditors. Marshals are private officers appointed by the Mayor of New York City — you hire them directly, without court involvement.
        </p>
        <div className="space-y-3">
          {[
            { title: 'Fee structure', body: 'Marshals typically charge 5% of the amount collected as their fee. You advance filing and levy costs (usually $50–$200 depending on the action); those costs are recoverable from the debtor as part of the judgment.' },
            { title: 'What they can do', body: 'Bank levy (freeze and seize funds from debtor\'s bank account); personal property execution (seize business equipment or inventory); income execution / wage garnishment (for individual defendants only — not applicable to LLCs or corporations).' },
            { title: 'How to find one', body: 'The official NYC Department of Investigation maintains the current marshal directory at nyc.gov — search "NYC City Marshal directory." Each marshal has a borough focus. Call first to confirm they handle commercial enforcement and to discuss the specific levy action you need.' },
            { title: 'What you\'ll need to provide', body: 'A certified copy of your judgment from the court clerk, the debtor\'s last known address, and — for a bank levy — the name and branch of the debtor\'s bank (which you may need to obtain via a post-judgment disclosure proceeding if unknown).' },
          ].map(({ title, body }) => (
            <div key={title} className="p-3 bg-slate-50 rounded-lg border border-slate-100">
              <div className="text-xs font-semibold text-slate-700 mb-1">{title}</div>
              <p className="text-xs text-slate-500 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
          <p className="text-xs text-blue-700 leading-relaxed">
            <strong>Official directory:</strong> Visit <strong>nyc.gov/site/doi/enforcement/city-marshals.page</strong> for the current list of active marshals with verified contact information and borough assignments. Do not rely on third-party marshal lists — contact information changes and must be confirmed directly.
          </p>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="card p-4 border-amber-200 bg-amber-50">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 leading-relaxed">
            This is general procedural information, not legal advice. Court rules, fees, and procedures change. Consult a NY-licensed attorney before filing, especially for claims above $10,000.
          </p>
        </div>
      </div>

    </div>
  );
}

// ─── Timeline Tab ──────────────────────────────────────────────────────────────

function TimelineTab({ caseData }: { caseData: Case }) {
  const queryClient = useQueryClient();
  const [actionType, setActionType] = useState<ActionType>('EMAIL_SENT');
  const [actionNotes, setActionNotes] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');

  const logMutation = useMutation({
    mutationFn: () => logAction(
      caseData.id,
      actionType,
      actionNotes || undefined,
      actionType === 'PAYMENT_RECEIVED' && paymentAmount ? { amount: parseFloat(paymentAmount) } : undefined
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case', caseData.id] });
      setActionNotes('');
      setPaymentAmount('');
    },
  });

  const sortedActions = [...caseData.actions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <div className="space-y-6">
      {/* Log Action Form */}
      <div className="card p-5">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Log an Action</div>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-xs text-slate-500 mb-1">Action Type</label>
            <select
              value={actionType}
              onChange={(e) => setActionType(e.target.value as ActionType)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {ACTION_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-[2]">
            <label className="block text-xs text-slate-500 mb-1">Notes</label>
            <textarea
              value={actionNotes}
              onChange={(e) => setActionNotes(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={2}
              placeholder="Optional notes..."
            />
          </div>
          {actionType === 'PAYMENT_RECEIVED' && (
            <div className="w-48 shrink-0">
              <label className="block text-xs text-slate-500 mb-1">Amount Received ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="0.00"
              />
            </div>
          )}
          <button
            onClick={() => logMutation.mutate()}
            disabled={logMutation.isPending}
            className="btn-primary text-sm whitespace-nowrap"
          >
            {logMutation.isPending && <Loader2 className="w-4 h-4 animate-spin inline mr-1" />}
            Log Action
          </button>
        </div>
      </div>

      {/* Timeline */}
      {sortedActions.length > 0 ? (
        <div className="card divide-y divide-slate-100">
          {sortedActions.map((action) => {
            const Icon = ACTION_ICONS[action.type] || Clock;
            return (
              <div key={action.id} className="flex items-start gap-4 p-4">
                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-slate-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800">
                    {action.label || action.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </div>
                  {action.notes && (
                    <p className="text-sm text-slate-500 mt-0.5">{action.notes}</p>
                  )}
                </div>
                <div className="text-xs text-slate-400 whitespace-nowrap shrink-0">
                  {formatDate(action.createdAt)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-8 text-sm text-slate-400">
          No actions logged yet. Actions will appear here as your case progresses.
        </div>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function CaseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  const { data: caseData, isLoading, error, refetch } = useQuery({
    queryKey: ['case', id],
    queryFn: () => getCase(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const analyzing = ['ANALYZING', 'GENERATING'].includes(data.status);
      const docsAnalyzing = data.documents.some((d) => d.classification === null);
      return analyzing || docsAnalyzing ? 3000 : false;
    },
  });

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <RotatingFact label="Loading case..." />
      </div>
    );
  }

  if (error || !caseData) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
        <div className="text-sm text-slate-600">Failed to load case. It may have been deleted.</div>
        <button onClick={() => navigate('/cases')} className="btn-secondary mt-4 text-sm">
          Back to Cases
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => navigate('/cases')} className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-slate-900 truncate">
            {caseData.title || `Case #${caseData.id.slice(0, 8)}`}
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <span className={`inline-flex px-2.5 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[caseData.status]}`}>
              {STATUS_LABELS[caseData.status]}
            </span>
            {caseData.strategy && (
              <span className="text-xs text-slate-500">
                {STRATEGY_LABELS[caseData.strategy]}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-slate-200 overflow-x-auto">
        {TABS.map(({ id: tabId, label, icon: Icon }) => (
          <button
            key={tabId}
            onClick={() => setActiveTab(tabId)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tabId
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && <OverviewTab caseData={caseData} />}
      {activeTab === 'evidence' && <EvidenceTab caseData={caseData} onRefresh={refetch} />}
      {activeTab === 'strategy' && <StrategyTab caseData={caseData} />}
      {activeTab === 'letter' && <LetterTab caseData={caseData} />}
      {activeTab === 'escalation' && <EscalationTab caseData={caseData} />}
      {activeTab === 'filing' && <FilingGuideTab caseData={caseData} />}
      {activeTab === 'timeline' && <TimelineTab caseData={caseData} />}
    </div>
  );
}
