import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Sparkles, FileText, AlertTriangle, Check, HelpCircle } from 'lucide-react';
import {
  createCase,
  createDraftCase,
  uploadDocuments,
  autofillFromDocuments,
  submitDraftCase,
  getCase,
  getErrorMessage,
} from '../lib/api';
import Alert from '../components/ui/Alert';
import Badge from '../components/ui/Badge';
import SectionCard from '../components/ui/SectionCard';
import UploadZone from '../components/evidence/UploadZone';
import { RotatingFact } from './case-detail/shared/RotatingFact';
import type { CreateCaseInput, IntakeAutofillResult, IntakeFieldName, ClarifyingQuestion, Document } from '../types';

const ENTITY_TYPES = ['LLC', 'Corporation', 'Sole Proprietor', 'Partnership', 'Individual', 'Unknown'];

type FormValues = {
  [K in keyof CreateCaseInput]: CreateCaseInput[K] | '';
};

const EMPTY_FORM: FormValues = {
  claimantName: '', claimantBusiness: '', claimantAddress: '', claimantEmail: '', claimantPhone: '',
  debtorName: '', debtorBusiness: '', debtorAddress: '', debtorEmail: '', debtorPhone: '', debtorEntityType: '',
  amountOwed: '', amountPaid: '', serviceDescription: '',
  agreementDate: '', serviceStartDate: '', serviceEndDate: '', invoiceDate: '', paymentDueDate: '',
  hasWrittenContract: false, invoiceNumber: '', industry: '', notes: '',
};

export default function NewCase() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [caseId, setCaseId] = useState<string | null>(null);
  const [docs, setDocs] = useState<Document[]>([]);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeStartedAt, setAnalyzeStartedAt] = useState<Date | null>(null);
  const [autofillError, setAutofillError] = useState<string | null>(null);
  const [autofillSummary, setAutofillSummary] = useState<{ filled: number; total: number } | null>(null);
  const [docSummary, setDocSummary] = useState<string | null>(null);
  const [questions, setQuestions] = useState<ClarifyingQuestion[]>([]);
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());

  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [aiFilled, setAiFilled] = useState<Map<IntakeFieldName, { sourceDocId: string | null; sourceExcerpt: string | null; confidence: 'high' | 'medium' | 'low' }>>(new Map());

  const docNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of docs) m.set(d.id, d.originalName);
    return m;
  }, [docs]);

  // Fields most users should fill before creating a case — used for a gentle pre-submit nudge.
  const missingRecommended = useMemo(() => {
    const m: string[] = [];
    if (!form.debtorName && !form.debtorBusiness) m.push('Debtor name');
    if (!form.serviceDescription) m.push('Description of services');
    if (!form.paymentDueDate) m.push('Payment due date (drives the filing deadline)');
    if (!form.debtorAddress) m.push('Debtor address (drives which court)');
    return m;
  }, [form.debtorName, form.debtorBusiness, form.serviceDescription, form.paymentDueDate, form.debtorAddress]);

  const submitMut = useMutation({
    mutationFn: async () => {
      const cleaned = cleanFormValues(form);
      if (caseId) return submitDraftCase(caseId, cleaned);
      return createCase(cleaned);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['cases'] });
      navigate(`/cases/${data.id}`);
    },
  });

  // ─── Handlers ───────────────────────────────────────────────────────────────

  function setField<K extends keyof FormValues>(name: K, value: FormValues[K]) {
    setForm((prev) => ({ ...prev, [name]: value }));
    if (aiFilled.has(name as IntakeFieldName)) {
      setAiFilled((prev) => {
        const next = new Map(prev);
        next.delete(name as IntakeFieldName);
        return next;
      });
    }
  }

  async function handleUpload(files: File[]) {
    setUploading(true);
    setAutofillError(null);
    try {
      let workingCaseId = caseId;
      if (!workingCaseId) {
        const draft = await createDraftCase();
        workingCaseId = draft.id;
        setCaseId(draft.id);
      }
      await uploadDocuments(workingCaseId, files);
      const updated = await getCase(workingCaseId);
      setDocs(updated.documents);
      setUploading(false);

      setAnalyzing(true);
      setAnalyzeStartedAt(new Date());
      try {
        const result = await autofillFromDocuments(workingCaseId);
        applyAutofill(result);
        const refreshed = await getCase(workingCaseId);
        setDocs(refreshed.documents);
      } catch (err: unknown) {
        setAutofillError(getErrorMessage(err, 'Autofill failed'));
      } finally {
        setAnalyzing(false);
        setAnalyzeStartedAt(null);
      }
    } catch (err) {
      console.error('Upload error:', err);
      setUploading(false);
      setAutofillError('Failed to upload documents — please try again.');
    }
  }

  function applyAutofill(result: IntakeAutofillResult) {
    const next: FormValues = { ...form };
    const newAiFilled = new Map(aiFilled);
    let filledCount = 0;
    let totalNonNull = 0;

    (Object.keys(result.fields) as IntakeFieldName[]).forEach((name) => {
      const f = result.fields[name];
      if (f.value === null || f.value === undefined || f.value === '') return;
      if (f.confidence === 'low') return;
      totalNonNull++;

      if (name === 'amountOwed' || name === 'amountPaid') {
        const num = typeof f.value === 'number' ? f.value : parseFloat(String(f.value));
        if (!Number.isFinite(num)) return;
        (next as Record<string, unknown>)[name] = num;
      } else if (name === 'hasWrittenContract') {
        (next as Record<string, unknown>)[name] = Boolean(f.value);
      } else {
        (next as Record<string, unknown>)[name] = String(f.value);
      }

      newAiFilled.set(name, { sourceDocId: f.sourceDocId, sourceExcerpt: f.sourceExcerpt, confidence: f.confidence });
      filledCount++;
    });

    setForm(next);
    setAiFilled(newAiFilled);
    setAutofillSummary({ filled: filledCount, total: totalNonNull });
    setDocSummary(result.documentSummary || null);
    setQuestions(result.clarifyingQuestions || []);
    setAnsweredIds(new Set());
  }

  function answerQuestion(q: ClarifyingQuestion, value: string) {
    const v = value.trim();
    if (!v) return;
    if (q.field) {
      if (q.field === 'amountOwed' || q.field === 'amountPaid') {
        const num = parseFloat(v.replace(/[$,]/g, ''));
        if (Number.isFinite(num)) setField(q.field, num);
      } else if (q.field === 'hasWrittenContract') {
        setField('hasWrittenContract', /^(y|yes|true)/i.test(v));
      } else {
        setField(q.field, v);
      }
    } else {
      // No target field — fold the answer into notes so it isn't lost.
      setForm((prev) => ({ ...prev, notes: `${prev.notes ? `${prev.notes}\n` : ''}${q.question} ${v}` }));
    }
    setAnsweredIds((prev) => new Set(prev).add(q.id));
  }

  const openQuestions = questions.filter((q) => !answeredIds.has(q.id));

  // ─── Render helpers ─────────────────────────────────────────────────────────

  function aiBadgeFor(name: IntakeFieldName) {
    const meta = aiFilled.get(name);
    if (!meta) return null;
    const filename = meta.sourceDocId ? docNameById.get(meta.sourceDocId) : null;
    const tooltip = filename
      ? `Extracted from: ${filename}${meta.sourceExcerpt ? `\n\n"${meta.sourceExcerpt}"` : ''}`
      : meta.sourceExcerpt ? `"${meta.sourceExcerpt}"` : 'AI-suggested — review and edit if needed';
    const tone = meta.confidence === 'high' ? 'info' : 'neutral';
    return (
      <Badge tone={tone} size="sm" title={tooltip} className="cursor-help">
        <Sparkles className="w-3 h-3" />
        AI
      </Badge>
    );
  }

  function FieldLabel({ name, children }: { name: IntakeFieldName | 'notes' | 'title'; children: React.ReactNode }) {
    return (
      <div className="flex items-center gap-2 mb-1.5">
        <label className="text-sm font-medium text-slate-700">{children}</label>
        {name !== 'notes' && name !== 'title' && aiBadgeFor(name as IntakeFieldName)}
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 lg:p-8">
      <div className="max-w-3xl mx-auto">
        <button onClick={() => navigate('/')} className="flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">New Collections Case</h1>
          <p className="text-slate-500 text-sm mt-1">
            Drop in your contracts, invoices, and emails — we'll read them, pre-fill the form, and ask a couple of quick questions.
          </p>
        </div>

        {/* Upload zone */}
        <div className="card p-5 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-blue-500" />
            <h2 className="text-base font-semibold text-slate-900">Auto-fill from documents</h2>
            <span className="text-xs text-slate-400 font-normal">(recommended)</span>
          </div>
          <p className="text-sm text-slate-500 mb-4">
            Drop your case documents here. We'll read them and pre-fill the form below — you can edit anything.
          </p>
          <UploadZone onUpload={handleUpload} uploading={uploading} />

          {docs.length > 0 && !uploading && !analyzing && (
            <div className="mt-3 text-xs text-slate-500 flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 text-slate-400" />
              {docs.length} file{docs.length !== 1 ? 's' : ''} attached
            </div>
          )}
        </div>

        {/* Analyzing loader */}
        {analyzing && analyzeStartedAt && (
          <div className="mb-5">
            <RotatingFact label="Reading your documents…" startedAt={analyzeStartedAt} estimatedSeconds={45} />
          </div>
        )}

        {/* What we found */}
        {docSummary && !analyzing && (
          <div className="mb-5">
            <SectionCard title={<div className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-blue-500" />What we found in your documents</div>} defaultOpen>
              <p className="text-sm text-slate-600 leading-relaxed">{docSummary}</p>
              {autofillSummary && (
                <p className="text-xs text-slate-400 mt-3">
                  Pre-filled {autofillSummary.filled} field{autofillSummary.filled !== 1 ? 's' : ''}. Review everything below — fields we couldn't find are blank for you to complete.
                </p>
              )}
            </SectionCard>
          </div>
        )}

        {/* Clarifying questions */}
        {openQuestions.length > 0 && !analyzing && (
          <div className="mb-5">
            <SectionCard
              title={<div className="flex items-center gap-2"><HelpCircle className="w-4 h-4 text-amber-500" />A few quick questions ({openQuestions.length})</div>}
              description="Answering these strengthens your case. Each answer fills the form for you."
              defaultOpen
            >
              <div className="space-y-4">
                {openQuestions.map((q) => (
                  <QuestionItem key={q.id} q={q} onAnswer={(v) => answerQuestion(q, v)} />
                ))}
              </div>
            </SectionCard>
          </div>
        )}
        {questions.length > 0 && openQuestions.length === 0 && !analyzing && (
          <div className="mb-5">
            <Alert tone="success" title="Thanks — that's everything we needed">
              You can still edit any answer in the form below.
            </Alert>
          </div>
        )}

        {/* Autofill error */}
        {autofillError && (
          <div className="mb-5">
            <Alert tone="warning" title="Auto-fill couldn't read your documents">
              {autofillError}. You can fill the form manually below.
            </Alert>
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); submitMut.mutate(); }}>
          {/* ─── Your Business ───────────────────────────────────────────── */}
          <SectionCard title="Your Business (Claimant)" description="The party that is owed money" defaultOpen className="mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel name="claimantName">Your Name</FieldLabel>
                <input className="input" placeholder="John Smith" value={form.claimantName ?? ''} onChange={(e) => setField('claimantName', e.target.value)} />
              </div>
              <div>
                <FieldLabel name="claimantBusiness">Business Name</FieldLabel>
                <input className="input" placeholder="Acme Services LLC" value={form.claimantBusiness ?? ''} onChange={(e) => setField('claimantBusiness', e.target.value)} />
              </div>
            </div>
            <div className="mt-4">
              <FieldLabel name="claimantAddress">Business Address</FieldLabel>
              <input className="input" placeholder="123 Main St, New York, NY 10001" value={form.claimantAddress ?? ''} onChange={(e) => setField('claimantAddress', e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <div>
                <FieldLabel name="claimantEmail">Email</FieldLabel>
                <input className="input" type="email" placeholder="you@yourbusiness.com" value={form.claimantEmail ?? ''} onChange={(e) => setField('claimantEmail', e.target.value)} />
              </div>
              <div>
                <FieldLabel name="claimantPhone">Phone</FieldLabel>
                <input className="input" placeholder="(212) 555-1234" value={form.claimantPhone ?? ''} onChange={(e) => setField('claimantPhone', e.target.value)} />
              </div>
            </div>
          </SectionCard>

          {/* ─── Debtor ─────────────────────────────────────────────────── */}
          <SectionCard title="Debtor" description="The party that owes you money" defaultOpen className="mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel name="debtorName">Contact Name</FieldLabel>
                <input className="input" placeholder="Jane Doe" value={form.debtorName ?? ''} onChange={(e) => setField('debtorName', e.target.value)} />
              </div>
              <div>
                <FieldLabel name="debtorBusiness">Business Name</FieldLabel>
                <input className="input" placeholder="Client Corp Inc." value={form.debtorBusiness ?? ''} onChange={(e) => setField('debtorBusiness', e.target.value)} />
              </div>
            </div>
            <div className="mt-4">
              <FieldLabel name="debtorEntityType">Entity Type</FieldLabel>
              <select className="input" value={form.debtorEntityType ?? ''} onChange={(e) => setField('debtorEntityType', e.target.value)}>
                <option value="">Select…</option>
                {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="mt-4">
              <FieldLabel name="debtorAddress">Address</FieldLabel>
              <input className="input" placeholder="456 Client Ave, New York, NY 10002" value={form.debtorAddress ?? ''} onChange={(e) => setField('debtorAddress', e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <div>
                <FieldLabel name="debtorEmail">Email</FieldLabel>
                <input className="input" type="email" placeholder="contact@theircorp.com" value={form.debtorEmail ?? ''} onChange={(e) => setField('debtorEmail', e.target.value)} />
              </div>
              <div>
                <FieldLabel name="debtorPhone">Phone</FieldLabel>
                <input className="input" placeholder="(212) 555-9876" value={form.debtorPhone ?? ''} onChange={(e) => setField('debtorPhone', e.target.value)} />
              </div>
            </div>
          </SectionCard>

          {/* ─── Claim Details ──────────────────────────────────────────── */}
          <SectionCard title="Claim Details" description="The amount owed and what was provided" defaultOpen className="mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel name="amountOwed">Amount Owed ($) <span className="text-red-500">*</span></FieldLabel>
                <input className="input" type="number" step="0.01" min="0" placeholder="5000.00" required value={form.amountOwed === '' ? '' : String(form.amountOwed ?? '')} onChange={(e) => setField('amountOwed', e.target.value === '' ? '' : parseFloat(e.target.value))} />
              </div>
              <div>
                <FieldLabel name="amountPaid">Amount Already Paid ($)</FieldLabel>
                <input className="input" type="number" step="0.01" min="0" placeholder="0.00" value={form.amountPaid === '' ? '' : String(form.amountPaid ?? '')} onChange={(e) => setField('amountPaid', e.target.value === '' ? '' : parseFloat(e.target.value))} />
              </div>
            </div>
            {typeof form.amountOwed === 'number' && typeof form.amountPaid === 'number' && form.amountPaid > form.amountOwed && (
              <p className="text-xs text-amber-600 mt-2">Amount paid is greater than amount owed — double-check these figures.</p>
            )}
            <div className="mt-4">
              <FieldLabel name="invoiceNumber">Invoice / Reference Number</FieldLabel>
              <input className="input" placeholder="INV-2024-001" value={form.invoiceNumber ?? ''} onChange={(e) => setField('invoiceNumber', e.target.value)} />
            </div>
            <div className="mt-4">
              <FieldLabel name="serviceDescription">Description of Services or Work Performed</FieldLabel>
              <textarea className="input min-h-[100px] resize-y" placeholder="E.g. Website redesign and development completed per the agreed scope of work…" value={form.serviceDescription ?? ''} onChange={(e) => setField('serviceDescription', e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <div>
                <FieldLabel name="serviceStartDate">Service Start Date</FieldLabel>
                <input className="input" type="date" value={form.serviceStartDate ?? ''} onChange={(e) => setField('serviceStartDate', e.target.value)} />
              </div>
              <div>
                <FieldLabel name="serviceEndDate">Service End / Completion Date</FieldLabel>
                <input className="input" type="date" value={form.serviceEndDate ?? ''} onChange={(e) => setField('serviceEndDate', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <div>
                <FieldLabel name="invoiceDate">Invoice Date</FieldLabel>
                <input className="input" type="date" value={form.invoiceDate ?? ''} onChange={(e) => setField('invoiceDate', e.target.value)} />
              </div>
              <div>
                <FieldLabel name="paymentDueDate">Payment Due Date</FieldLabel>
                <input className="input" type="date" value={form.paymentDueDate ?? ''} onChange={(e) => setField('paymentDueDate', e.target.value)} />
              </div>
            </div>
            <div className="mt-4">
              <FieldLabel name="industry">Industry</FieldLabel>
              <input className="input" placeholder="e.g. Construction, Web Design, Consulting" value={form.industry ?? ''} onChange={(e) => setField('industry', e.target.value)} />
            </div>
          </SectionCard>

          {/* ─── Agreement ──────────────────────────────────────────────── */}
          <SectionCard title="Agreement & Notes" description="Contract details and any other context" defaultOpen className="mb-4">
            <div>
              <FieldLabel name="agreementDate">Agreement Date</FieldLabel>
              <input className="input" type="date" value={form.agreementDate ?? ''} onChange={(e) => setField('agreementDate', e.target.value)} />
            </div>
            <div className="mt-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" checked={Boolean(form.hasWrittenContract)} onChange={(e) => setField('hasWrittenContract', e.target.checked)} />
                <span className="text-sm text-slate-700 font-medium">There is a written contract or formal agreement</span>
                {aiBadgeFor('hasWrittenContract')}
              </label>
            </div>
            <div className="mt-4">
              <FieldLabel name="notes">Additional Notes</FieldLabel>
              <textarea className="input min-h-[100px] resize-y" placeholder="Any other relevant context, prior communication attempts, or important background…" value={form.notes ?? ''} onChange={(e) => setField('notes', e.target.value)} />
            </div>
          </SectionCard>

          {submitMut.isError && (
            <div className="mb-4">
              <Alert tone="danger" title="Failed to create case">
                {getErrorMessage(submitMut.error, 'Please check your input and try again.')}
              </Alert>
            </div>
          )}

          {!form.amountOwed ? (
            <div className="mb-4">
              <Alert tone="neutral">
                <div className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4 text-slate-400 shrink-0" />
                  <span><strong>Amount Owed</strong> is required to create a case.</span>
                </div>
              </Alert>
            </div>
          ) : missingRecommended.length > 0 ? (
            <div className="mb-4">
              <Alert tone="info" title="You can create the case now, but these will make it stronger">
                <ul className="list-disc list-inside text-sm mt-1 space-y-0.5">
                  {missingRecommended.map((m) => <li key={m}>{m}</li>)}
                </ul>
              </Alert>
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-3 pb-12">
            <button type="button" onClick={() => navigate('/')} className="btn-secondary" disabled={submitMut.isPending}>
              Cancel
            </button>
            <button type="submit" disabled={submitMut.isPending || !form.amountOwed || analyzing || uploading} className="btn-primary btn-lg">
              {submitMut.isPending ? 'Creating Case…' : 'Create Case'}
              {!submitMut.isPending && <ArrowRight className="w-4 h-4" />}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function QuestionItem({ q, onAnswer }: { q: ClarifyingQuestion; onAnswer: (v: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="text-sm font-medium text-slate-800">{q.question}</div>
      {q.why && <div className="text-xs text-slate-500 mt-1">{q.why}</div>}
      {q.suggestions && q.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {q.suggestions.map((s) => (
            <button key={s} type="button" onClick={() => onAnswer(s)} className="px-3 py-1 rounded-full border border-slate-300 text-xs text-slate-700 hover:bg-slate-50">
              {s}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex items-center gap-2 mt-3"
        onSubmit={(e) => { e.preventDefault(); onAnswer(value); }}
      >
        <input className="input flex-1" placeholder="Type your answer…" value={value} onChange={(e) => setValue(e.target.value)} />
        <button type="submit" disabled={!value.trim()} className="btn-secondary text-sm">
          <Check className="w-4 h-4" /> Save
        </button>
      </form>
    </div>
  );
}

function cleanFormValues(form: FormValues): CreateCaseInput {
  const out: Record<string, unknown> = {};
  (Object.keys(form) as (keyof FormValues)[]).forEach((key) => {
    const val = form[key];
    if (val === '' || val === undefined || val === null) return;
    out[key] = val;
  });
  return out as CreateCaseInput;
}
