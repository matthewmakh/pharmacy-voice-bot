import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Sparkles, FileText, AlertTriangle, Check, HelpCircle, Wand2, Loader2, X, Pencil } from 'lucide-react';
import {
  createCase,
  createDraftCase,
  uploadDocuments,
  autofillFromDocuments,
  applyIntakeAnswers,
  submitDraftCase,
  getCase,
  getErrorMessage,
  type ProposedFieldUpdate,
} from '../lib/api';
import Alert from '../components/ui/Alert';
import Badge from '../components/ui/Badge';
import SectionCard from '../components/ui/SectionCard';
import UploadZone from '../components/evidence/UploadZone';
import { RotatingFact } from './case-detail/shared/RotatingFact';
import type { CreateCaseInput, IntakeAutofillResult, IntakeFieldName, ClarifyingQuestion, Document } from '../types';

const ENTITY_TYPES = ['LLC', 'Corporation', 'Sole Proprietor', 'Partnership', 'Individual', 'Unknown'];

const FIELD_LABELS: Record<IntakeFieldName, string> = {
  claimantName: 'Your name', claimantBusiness: 'Your business', claimantAddress: 'Your address',
  claimantEmail: 'Your email', claimantPhone: 'Your phone',
  debtorName: 'Debtor contact', debtorBusiness: 'Debtor business', debtorAddress: 'Debtor address',
  debtorEmail: 'Debtor email', debtorPhone: 'Debtor phone', debtorEntityType: 'Debtor entity type',
  amountOwed: 'Amount owed', amountPaid: 'Amount paid', serviceDescription: 'Services / work',
  agreementDate: 'Agreement date', serviceStartDate: 'Service start', serviceEndDate: 'Service end',
  invoiceDate: 'Invoice date', paymentDueDate: 'Payment due date', hasWrittenContract: 'Written contract',
  invoiceNumber: 'Invoice number', industry: 'Industry',
};

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

function coerceValue(field: IntakeFieldName, value: unknown): string | number | boolean {
  if (field === 'amountOwed' || field === 'amountPaid') {
    const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[$,]/g, ''));
    return Number.isFinite(n) ? n : '';
  }
  if (field === 'hasWrittenContract') return typeof value === 'boolean' ? value : /^(y|yes|true)/i.test(String(value));
  return value == null ? '' : String(value);
}

function displayValue(v: unknown): string {
  if (v === '' || v == null) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

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
  // Saved answers (pinned, editable) — keyed by question id. They are NOT applied to the
  // form until the user runs "Save & submit all", which sends them all in one AI pass.
  const [savedAnswers, setSavedAnswers] = useState<Record<string, string>>({});
  // Proposed field changes returned by that pass, awaiting per-item accept/discard.
  const [proposed, setProposed] = useState<ProposedFieldUpdate[] | null>(null);
  const [applyNotes, setApplyNotes] = useState<string>('');
  const [applyError, setApplyError] = useState<string | null>(null);

  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [aiFilled, setAiFilled] = useState<Map<IntakeFieldName, { sourceDocId: string | null; sourceExcerpt: string | null; confidence: 'high' | 'medium' | 'low' }>>(new Map());

  const docNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of docs) m.set(d.id, d.originalName);
    return m;
  }, [docs]);

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

  const applyMut = useMutation({
    mutationFn: () => {
      const answers = questions
        .filter((q) => (savedAnswers[q.id] ?? '').trim().length > 0)
        .map((q) => ({ question: q.question, answer: savedAnswers[q.id].trim(), field: q.field }));
      return applyIntakeAnswers(caseId!, cleanFormValues(form) as Record<string, unknown>, answers);
    },
    onSuccess: (result) => {
      setProposed(result.updates);
      setApplyNotes(result.notes);
      setApplyError(null);
    },
    onError: (err) => setApplyError(getErrorMessage(err, 'Could not process your answers — try again.')),
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
      (next as Record<string, unknown>)[name] = coerceValue(name, f.value);
      newAiFilled.set(name, { sourceDocId: f.sourceDocId, sourceExcerpt: f.sourceExcerpt, confidence: f.confidence });
      filledCount++;
    });

    setForm(next);
    setAiFilled(newAiFilled);
    setAutofillSummary({ filled: filledCount, total: totalNonNull });
    setDocSummary(result.documentSummary || null);
    setQuestions(result.clarifyingQuestions || []);
    setSavedAnswers({});
    setProposed(null);
  }

  function acceptUpdate(u: ProposedFieldUpdate) {
    setField(u.field, coerceValue(u.field, u.value) as FormValues[typeof u.field]);
    // Reuse the AI badge mechanism — the reasoning shows as the field's hover tooltip.
    setAiFilled((prev) => new Map(prev).set(u.field, { sourceDocId: null, sourceExcerpt: u.reasoning, confidence: u.confidence }));
    setProposed((prev) => (prev ? prev.filter((p) => p !== u) : prev));
  }
  function discardUpdate(u: ProposedFieldUpdate) {
    setProposed((prev) => (prev ? prev.filter((p) => p !== u) : prev));
  }

  const savedCount = questions.filter((q) => (savedAnswers[q.id] ?? '').trim().length > 0).length;

  // ─── Render helpers ─────────────────────────────────────────────────────────

  function aiBadgeFor(name: IntakeFieldName) {
    const meta = aiFilled.get(name);
    if (!meta) return null;
    const filename = meta.sourceDocId ? docNameById.get(meta.sourceDocId) : null;
    const tooltip = filename
      ? `Extracted from: ${filename}${meta.sourceExcerpt ? `\n\n"${meta.sourceExcerpt}"` : ''}`
      : meta.sourceExcerpt ? meta.sourceExcerpt : 'AI-suggested — review and edit if needed';
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

        {analyzing && analyzeStartedAt && (
          <div className="mb-5">
            <RotatingFact label="Reading your documents…" startedAt={analyzeStartedAt} estimatedSeconds={45} />
          </div>
        )}

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

        {/* Clarifying questions — answers are saved/pinned, then applied together */}
        {questions.length > 0 && !analyzing && (
          <div className="mb-5">
            <SectionCard
              title={<div className="flex items-center gap-2"><HelpCircle className="w-4 h-4 text-amber-500" />A few quick questions</div>}
              description="Answer what you can — including anything that needs math (penalties, partial payments, per-item pricing). Save each one; then “Save &amp; submit all” and we'll turn them into proposed updates you can review before they touch the form."
              defaultOpen
            >
              <div className="space-y-3">
                {questions.map((q) => (
                  <QuestionItem
                    key={q.id}
                    q={q}
                    saved={savedAnswers[q.id]}
                    onSave={(v) => setSavedAnswers((prev) => ({ ...prev, [q.id]: v }))}
                    onClear={() => setSavedAnswers((prev) => { const next = { ...prev }; delete next[q.id]; return next; })}
                  />
                ))}
              </div>

              <div className="flex items-center justify-between gap-3 mt-4 pt-4 border-t border-slate-100">
                <span className="text-xs text-slate-500">{savedCount} answer{savedCount !== 1 ? 's' : ''} saved</span>
                <button
                  onClick={() => applyMut.mutate()}
                  disabled={savedCount === 0 || applyMut.isPending}
                  className="btn-primary text-sm"
                >
                  {applyMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  {applyMut.isPending ? 'Working through your answers…' : 'Save & submit all'}
                </button>
              </div>
              {applyError && <p className="text-xs text-red-600 mt-2">{applyError}</p>}
            </SectionCard>
          </div>
        )}

        {/* Review proposed changes before they touch the form */}
        {proposed && (
          <div className="mb-5">
            <SectionCard
              title={<div className="flex items-center gap-2"><Wand2 className="w-4 h-4 text-blue-500" />Proposed changes from your answers</div>}
              description="Nothing has changed yet. Accept each update to apply it, or discard it. Accepted fields are marked AI so you can tweak them after."
              defaultOpen
              action={<button onClick={() => setProposed(null)} className="text-xs text-slate-400 hover:text-slate-600 inline-flex items-center gap-1"><X className="w-3.5 h-3.5" />Close</button>}
            >
              {applyNotes && <Alert tone="info" title="What we did">{applyNotes}</Alert>}
              {proposed.length === 0 ? (
                <p className="text-sm text-slate-500 mt-3">No further changes — your answers matched what's already in the form.</p>
              ) : (
                <div className="space-y-3 mt-3">
                  {proposed.map((u, i) => (
                    <div key={i} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <span className="text-sm font-semibold text-slate-800">{FIELD_LABELS[u.field]}</span>
                        <Badge tone={u.confidence === 'high' ? 'info' : 'neutral'} size="sm"><Sparkles className="w-3 h-3" />AI</Badge>
                      </div>
                      <div className="flex items-center gap-2 text-sm mb-2 flex-wrap">
                        <span className="text-slate-400 line-through">{displayValue(form[u.field as keyof FormValues])}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="font-medium text-slate-900">{displayValue(u.value)}</span>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed">{u.reasoning}</p>
                      <div className="flex items-center gap-2 mt-3">
                        <button onClick={() => acceptUpdate(u)} className="btn-primary text-xs"><Check className="w-3.5 h-3.5" />Accept</button>
                        <button onClick={() => discardUpdate(u)} className="btn-ghost text-xs">Discard</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        )}

        {autofillError && (
          <div className="mb-5">
            <Alert tone="warning" title="Auto-fill couldn't read your documents">
              {autofillError}. You can fill the form manually below.
            </Alert>
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); submitMut.mutate(); }}>
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
              <Alert tone="danger" title="Failed to create case">{getErrorMessage(submitMut.error, 'Please check your input and try again.')}</Alert>
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
            <button type="button" onClick={() => navigate('/')} className="btn-secondary" disabled={submitMut.isPending}>Cancel</button>
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

function QuestionItem({ q, saved, onSave, onClear }: { q: ClarifyingQuestion; saved: string | undefined; onSave: (v: string) => void; onClear: () => void }) {
  const isSaved = (saved ?? '').trim().length > 0;
  const [value, setValue] = useState(saved ?? '');
  const [editing, setEditing] = useState(false);
  const open = !isSaved || editing;

  if (!open) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-800 flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />{q.question}</div>
            <div className="text-sm text-slate-600 mt-1 break-words">{saved}</div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => { setValue(saved ?? ''); setEditing(true); }} className="p-1.5 text-slate-400 hover:text-blue-600" title="Edit answer"><Pencil className="w-3.5 h-3.5" /></button>
            <button onClick={onClear} className="p-1.5 text-slate-400 hover:text-red-500" title="Remove answer"><X className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="text-sm font-medium text-slate-800">{q.question}</div>
      {q.why && <div className="text-xs text-slate-500 mt-1">{q.why}</div>}
      {q.suggestions && q.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {q.suggestions.map((s) => (
            <button key={s} type="button" onClick={() => setValue(s)} className="px-3 py-1 rounded-full border border-slate-300 text-xs text-slate-700 hover:bg-slate-50">{s}</button>
          ))}
        </div>
      )}
      <form className="flex items-start gap-2 mt-3" onSubmit={(e) => { e.preventDefault(); if (value.trim()) { onSave(value.trim()); setEditing(false); } }}>
        <textarea className="input flex-1 min-h-[44px] resize-y" placeholder="Type your answer — include any details or math…" value={value} onChange={(e) => setValue(e.target.value)} />
        <button type="submit" disabled={!value.trim()} className="btn-secondary text-sm shrink-0"><Check className="w-4 h-4" />Save</button>
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
