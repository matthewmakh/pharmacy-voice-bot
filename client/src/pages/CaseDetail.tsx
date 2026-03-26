import { useState } from 'react';
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
} from 'lucide-react';
import {
  getCase,
  analyzeCase,
  setStrategy,
  generateLetter,
  generateFinalNotice,
  generateFilingPacket,
  uploadDocuments,
  deleteDocument,
  logAction,
  updateCase,
  getDocumentViewUrl,
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
import type { Case, Strategy, ActionType } from '../types';
import UploadZone from '../components/evidence/UploadZone';

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
              {field('Entity Type', 'debtorEntityType')}
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
              {caseData.debtorEntityType && (
                <div className="inline-block mt-1 px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full">
                  {caseData.debtorEntityType}
                </div>
              )}
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

      {/* Missing Info */}
      {missingInfo.length > 0 && (
        <div className="card p-5 border-amber-200 bg-amber-50">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-amber-800 text-sm mb-2">Missing Information</div>
              <ul className="space-y-1">
                {missingInfo.map((item, i) => (
                  <li key={i} className="text-sm text-amber-700 flex items-start gap-1.5">
                    <span className="text-amber-400 mt-0.5">•</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
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
        </div>
      )}

      {isAnalyzing && (
        <div className="card p-6 text-center">
          <Loader2 className="w-10 h-10 text-purple-500 mx-auto mb-3 animate-spin" />
          <div className="text-sm font-semibold text-slate-800">Analyzing your case...</div>
          <p className="text-xs text-slate-400 mt-1">This usually takes 15–30 seconds.</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        {strategies.map((s) => {
          const isSelected = caseData.strategy === s.id;
          return (
            <button
              key={s.id}
              onClick={() => strategyMutation.mutate(s.id)}
              disabled={strategyMutation.isPending}
              className={`card p-5 text-left transition-all ${
                isSelected
                  ? 'border-blue-500 ring-2 ring-blue-200 bg-blue-50/50'
                  : 'hover:border-slate-300'
              }`}
            >
              <div className="text-sm font-semibold text-slate-800 mb-2">{s.title}</div>
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

  const handleEmail = () => {
    if (!caseData.debtorEmail) return;
    const subject = encodeURIComponent(`Demand for Payment — ${caseData.debtorBusiness || caseData.debtorName || 'Outstanding Balance'}`);
    const body = encodeURIComponent(caseData.demandLetter || '');
    window.open(`mailto:${caseData.debtorEmail}?subject=${subject}&body=${body}`);
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
    return (
      <div className="card p-8 text-center">
        <Loader2 className="w-10 h-10 text-purple-500 mx-auto mb-3 animate-spin" />
        <div className="text-sm font-semibold text-slate-800">Generating demand letter...</div>
        <p className="text-xs text-slate-400 mt-1">This usually takes 20–40 seconds.</p>
      </div>
    );
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
  const [copiedFP, setCopiedFP] = useState(false);

  const finalNoticeMutation = useMutation({
    mutationFn: () => generateFinalNotice(caseData.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });

  const filingPacketMutation = useMutation({
    mutationFn: () => generateFilingPacket(caseData.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });

  const handleCopyFN = () => {
    if (caseData.finalNotice) {
      navigator.clipboard.writeText(caseData.finalNotice);
      setCopiedFN(true);
      setTimeout(() => setCopiedFN(false), 2000);
    }
  };

  const handleCopyFP = () => {
    if (caseData.filingPacket) {
      navigator.clipboard.writeText(caseData.filingPacket);
      setCopiedFP(true);
      setTimeout(() => setCopiedFP(false), 2000);
    }
  };

  const handleEmailFN = () => {
    if (!caseData.debtorEmail || !caseData.finalNotice) return;
    const subject = encodeURIComponent(`Final Notice — ${caseData.debtorBusiness || caseData.debtorName || 'Outstanding Balance'}`);
    const body = encodeURIComponent(caseData.finalNotice);
    window.open(`mailto:${caseData.debtorEmail}?subject=${subject}&body=${body}`);
  };

  return (
    <div className="space-y-8">
      {/* Section 1: Final Notice */}
      <div>
        <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <Shield className="w-4 h-4 text-red-500" /> Final Notice
        </h3>
        {caseData.finalNoticeHtml ? (
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
                disabled={finalNoticeMutation.isPending}
                className="btn-secondary text-sm ml-auto"
              >
                {finalNoticeMutation.isPending && <Loader2 className="w-4 h-4 animate-spin inline mr-1" />}
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
              Generate a final notice before escalating to legal action.
            </p>
            <button
              onClick={() => finalNoticeMutation.mutate()}
              disabled={finalNoticeMutation.isPending}
              className="btn-primary"
            >
              {finalNoticeMutation.isPending && <Loader2 className="w-4 h-4 animate-spin inline mr-2" />}
              Generate Final Notice
            </button>
          </div>
        )}
      </div>

      {/* Section 2: Filing Packet */}
      <div>
        <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <Scale className="w-4 h-4 text-blue-500" /> Filing Packet
        </h3>
        {caseData.filingPacket ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <button onClick={handleCopyFP} className="btn-secondary text-sm flex items-center gap-2">
                <Copy className="w-4 h-4" /> {copiedFP ? 'Copied!' : 'Copy Text'}
              </button>
              <button
                onClick={() => filingPacketMutation.mutate()}
                disabled={filingPacketMutation.isPending}
                className="btn-secondary text-sm ml-auto"
              >
                {filingPacketMutation.isPending && <Loader2 className="w-4 h-4 animate-spin inline mr-1" />}
                Regenerate
              </button>
            </div>
            <div className="card p-8">
              <pre className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed font-sans">
                {caseData.filingPacket}
              </pre>
            </div>
          </div>
        ) : (
          <div className="card p-6 text-center">
            <p className="text-sm text-slate-500 mb-4">
              Generate a filing packet with all necessary information for court filing.
            </p>
            <button
              onClick={() => filingPacketMutation.mutate()}
              disabled={filingPacketMutation.isPending}
              className="btn-primary"
            >
              {filingPacketMutation.isPending && <Loader2 className="w-4 h-4 animate-spin inline mr-2" />}
              Generate Filing Packet
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── NY Filing Guide Tab ───────────────────────────────────────────────────────

function FilingGuideTab({ caseData }: { caseData: Case }) {
  const outstanding = parseFloat(caseData.amountOwed || '0') - parseFloat(caseData.amountPaid || '0');

  const getCourtInfo = () => {
    if (outstanding <= 10000) {
      return {
        court: 'NYC Small Claims Court',
        fee: '$15–$20',
        lawyer: 'No lawyer needed',
        detail: 'File at your local NYC Civil Court, Small Claims Part. Cases are typically heard within 1–2 months. Judgments can be enforced via bank levy or wage garnishment.',
        highlight: 'bg-green-50 border-green-200',
        badge: 'bg-green-100 text-green-700',
      };
    }
    if (outstanding <= 25000) {
      return {
        court: 'NYC Civil Court',
        fee: '~$45',
        lawyer: 'Attorney recommended',
        detail: 'File at NYC Civil Court. You must serve the defendant via process server. Trials are typically scheduled within 6–12 months.',
        highlight: 'bg-amber-50 border-amber-200',
        badge: 'bg-amber-100 text-amber-700',
      };
    }
    return {
      court: 'NY Supreme Court',
      fee: '$210+',
      lawyer: 'Attorney strongly recommended',
      detail: 'File in the county where the defendant does business. The discovery process applies. This is the most formal court track.',
      highlight: 'bg-red-50 border-red-200',
      badge: 'bg-red-100 text-red-700',
    };
  };

  const info = getCourtInfo();

  return (
    <div className="space-y-6">
      {/* Court Routing */}
      <div className={`card p-6 ${info.highlight}`}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-lg font-bold text-slate-900">{info.court}</div>
            <div className="text-sm text-slate-600 mt-1">{info.detail}</div>
          </div>
          <span className={`text-xs font-semibold px-3 py-1 rounded-full ${info.badge}`}>
            {formatCurrency(outstanding)} outstanding
          </span>
        </div>
        <div className="flex gap-6 mt-4 text-sm">
          <div>
            <span className="text-slate-500">Filing Fee:</span>{' '}
            <span className="font-semibold text-slate-800">{info.fee}</span>
          </div>
          <div>
            <span className="text-slate-500">Legal Representation:</span>{' '}
            <span className="font-semibold text-slate-800">{info.lawyer}</span>
          </div>
        </div>
      </div>

      {/* All Courts Reference */}
      <div className="card p-6">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Court Thresholds Reference</div>
        <div className="grid grid-cols-3 gap-4">
          <div className={`p-4 rounded-lg border ${outstanding <= 10000 ? 'border-blue-300 bg-blue-50' : 'border-slate-100'}`}>
            <div className="text-sm font-semibold text-slate-800">Small Claims</div>
            <div className="text-xs text-slate-500 mt-1">Up to $10,000</div>
            <div className="text-xs text-slate-400 mt-0.5">Fee: $15–$20</div>
          </div>
          <div className={`p-4 rounded-lg border ${outstanding > 10000 && outstanding <= 25000 ? 'border-blue-300 bg-blue-50' : 'border-slate-100'}`}>
            <div className="text-sm font-semibold text-slate-800">Civil Court</div>
            <div className="text-xs text-slate-500 mt-1">$10,001–$25,000</div>
            <div className="text-xs text-slate-400 mt-0.5">Fee: ~$45</div>
          </div>
          <div className={`p-4 rounded-lg border ${outstanding > 25000 ? 'border-blue-300 bg-blue-50' : 'border-slate-100'}`}>
            <div className="text-sm font-semibold text-slate-800">Supreme Court</div>
            <div className="text-xs text-slate-500 mt-1">Over $25,000</div>
            <div className="text-xs text-slate-400 mt-0.5">Fee: $210+</div>
          </div>
        </div>
      </div>

      {/* General Steps */}
      <div className="card p-6">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">General Filing Steps</div>
        <ol className="space-y-3">
          {[
            'Ensure your demand letter was sent and documented (keep proof of delivery).',
            'Gather all supporting documents: contract, invoices, proof of delivery/work, and all correspondence.',
            'File a summons and complaint at the appropriate court.',
            'Serve the defendant — use a process server for Supreme/Civil Court. For Small Claims, the court clerk can assist with service.',
            'Attend the hearing. If the defendant does not respond within 30 days, you may seek a default judgment.',
            'Enforce the judgment through bank levy, property lien, or wage garnishment.',
          ].map((step, i) => (
            <li key={i} className="flex gap-3 text-sm text-slate-700">
              <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-xs font-bold shrink-0">
                {i + 1}
              </span>
              <span className="leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Disclaimer */}
      <div className="card p-5 border-amber-200 bg-amber-50">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 leading-relaxed">
            This is general information, not legal advice. Consult a NY-licensed attorney for your specific situation.
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

  const logMutation = useMutation({
    mutationFn: () => logAction(caseData.id, actionType, actionNotes || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case', caseData.id] });
      setActionNotes('');
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
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
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
