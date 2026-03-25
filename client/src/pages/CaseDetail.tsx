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
  Download,
  Send,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { getCase, analyzeCase, setStrategy, generateLetter, uploadDocuments, deleteDocument, logAction } from '../lib/api';
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
import type { Case, Strategy } from '../types';
import UploadZone from '../components/evidence/UploadZone';

type Tab = 'overview' | 'evidence' | 'strategy' | 'letter' | 'timeline';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'evidence', label: 'Evidence', icon: Upload },
  { id: 'strategy', label: 'Strategy', icon: Zap },
  { id: 'letter', label: 'Demand Letter', icon: FileText },
  { id: 'timeline', label: 'Timeline', icon: Clock },
];

// ─── Sub-components ────────────────────────────────────────────────────────────

function OverviewTab({ caseData }: { caseData: Case }) {
  const outstanding =
    parseFloat(caseData.amountOwed || '0') - parseFloat(caseData.amountPaid || '0');
  const evidenceSummary = caseData.evidenceSummary as Record<string, unknown> | null;
  const missingInfo = caseData.missingInfo || [];

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

      {/* Parties */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card p-5">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Claimant (You)</div>
          <div className="space-y-1">
            {caseData.claimantBusiness && <div className="font-semibold text-slate-900">{caseData.claimantBusiness}</div>}
            {caseData.claimantName && <div className="text-sm text-slate-700">{caseData.claimantName}</div>}
            {caseData.claimantAddress && <div className="text-sm text-slate-500">{caseData.claimantAddress}</div>}
            {caseData.claimantEmail && <div className="text-sm text-slate-500">{caseData.claimantEmail}</div>}
          </div>
        </div>
        <div className="card p-5">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Debtor</div>
          <div className="space-y-1">
            {caseData.debtorBusiness && <div className="font-semibold text-slate-900">{caseData.debtorBusiness}</div>}
            {caseData.debtorName && <div className="text-sm text-slate-700">{caseData.debtorName}</div>}
            {caseData.debtorAddress && <div className="text-sm text-slate-500">{caseData.debtorAddress}</div>}
            {caseData.debtorEntityType && (
              <div className="inline-block mt-1 px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full">
                {caseData.debtorEntityType}
              </div>
            )}
          </div>
        </div>
      </div>

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

      {/* Case Strength */}
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
              <span className="text-xs text-slate-700">{String(evidenceSummary.strongestEvidence as string)}</span>
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

function EvidenceTab({
  caseData,
  onRefresh,
}: {
  caseData: Case;
  onRefresh: () => void;
}) {
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);

  const analyzeMutation = useMutation({
    mutationFn: () => analyzeCase(caseData.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case', caseData.id] });
      queryClient.invalidateQueries({ queryKey: ['cases'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (docId: string) => deleteDocument(caseData.id, docId),
    onSuccess: () => onRefresh(),
  });

  const handleUpload = async (files: File[]) => {
    setUploading(true);
    try {
      await uploadDocuments(caseData.id, files);
      onRefresh();
    } finally {
      setUploading(false);
    }
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      await analyzeMutation.mutateAsync();
    } finally {
      setAnalyzing(false);
    }
  };

  const docs = caseData.documents;
  const canAnalyze = docs.length > 0 && !['ANALYZING', 'GENERATING'].includes(caseData.status);

  return (
    <div className="space-y-6">
      <UploadZone onUpload={handleUpload} uploading={uploading} />

      {docs.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-900">{docs.length} Document{docs.length !== 1 ? 's' : ''} Uploaded</h3>
            {canAnalyze && (
              <button
                onClick={handleAnalyze}
                disabled={analyzing || analyzeMutation.isPending}
                className="btn-primary"
              >
                {analyzing || analyzeMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    Run AI Analysis
                  </>
                )}
              </button>
            )}
          </div>

          <div className="space-y-3">
            {docs.map((doc) => {
              const expanded = expandedDoc === doc.id;
              return (
                <div key={doc.id} className="card">
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-slate-900 truncate">{doc.originalName}</span>
                          {doc.classification && (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${DOC_CLASSIFICATION_COLORS[doc.classification] || 'bg-slate-100 text-slate-600'}`}>
                              {DOC_CLASSIFICATION_LABELS[doc.classification] || doc.classification}
                            </span>
                          )}
                        </div>
                        {doc.summary && (
                          <p className="text-xs text-slate-500 mt-1 line-clamp-2">{doc.summary}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="text-xs text-slate-400">{formatFileSize(doc.size)}</span>
                          {doc.supportsTags.length > 0 && (
                            <div className="flex items-center gap-1 flex-wrap">
                              {doc.supportsTags.slice(0, 3).map((tag) => (
                                <span key={tag} className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                                  {tag.replace(/_/g, ' ')}
                                </span>
                              ))}
                              {doc.supportsTags.length > 3 && (
                                <span className="text-xs text-slate-400">+{doc.supportsTags.length - 3} more</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {doc.extractedText && (
                          <button
                            onClick={() => setExpandedDoc(expanded ? null : doc.id)}
                            className="btn-ghost btn-sm"
                          >
                            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                        )}
                        <button
                          onClick={() => deleteMutation.mutate(doc.id)}
                          disabled={deleteMutation.isPending}
                          className="btn-ghost btn-sm text-red-500 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                  {expanded && doc.extractedText && (
                    <div className="border-t border-slate-100 p-4 bg-slate-50">
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Extracted Text</div>
                      <pre className="text-xs text-slate-600 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
                        {doc.extractedText.slice(0, 2000)}{doc.extractedText.length > 2000 ? '...' : ''}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {docs.length === 0 && (
        <div className="text-center py-8 text-slate-400 text-sm">
          No documents uploaded yet. Upload contracts, invoices, messages, or any relevant files.
        </div>
      )}
    </div>
  );
}

function StrategyTab({ caseData }: { caseData: Case }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Strategy | null>(caseData.strategy);

  const strategyMutation = useMutation({
    mutationFn: (strategy: Strategy) => setStrategy(caseData.id, strategy),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case', caseData.id] });
      queryClient.invalidateQueries({ queryKey: ['cases'] });
    },
  });

  const strategies: Array<{
    id: Strategy;
    name: string;
    deadline: string;
    description: string;
    bullets: string[];
    color: string;
  }> = [
    {
      id: 'QUICK_ESCALATION',
      name: 'Quick Escalation',
      deadline: '7-day deadline',
      description: 'Direct, firm, and urgent. Best when prior attempts have failed or the relationship is not a concern.',
      bullets: [
        'Strong opening demand language',
        'Clear 7-day payment deadline',
        'Explicit reference to legal action',
        'Suitable for non-responsive debtors',
      ],
      color: 'border-red-200 hover:border-red-400',
    },
    {
      id: 'STANDARD_RECOVERY',
      name: 'Standard Recovery',
      deadline: '14-day deadline',
      description: 'Professional and firm. The most common approach for B2B collection matters.',
      bullets: [
        'Professional, factual tone',
        '14-day payment deadline',
        'Standard legal consequence language',
        'Balanced and widely used',
      ],
      color: 'border-blue-200 hover:border-blue-400',
    },
    {
      id: 'GRADUAL_APPROACH',
      name: 'Gradual Approach',
      deadline: '21-day deadline',
      description: 'Measured and cooperative. Preserves the business relationship while still putting the debtor on notice.',
      bullets: [
        'Conciliatory but firm tone',
        '21-day payment window',
        'Softer next-step language',
        'Suitable when relationship matters',
      ],
      color: 'border-slate-200 hover:border-slate-400',
    },
  ];

  const canSelect = !['ANALYZING', 'GENERATING', 'DRAFT'].includes(caseData.status);

  if (!canSelect && caseData.status === 'DRAFT') {
    return (
      <div className="card p-8 text-center">
        <AlertCircle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
        <h3 className="font-semibold text-slate-900 mb-2">Complete Case Assembly First</h3>
        <p className="text-sm text-slate-500">Upload documents and run AI analysis before selecting a strategy.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-semibold text-slate-900 mb-1">Choose Your Recovery Path</h3>
        <p className="text-sm text-slate-500">
          Select the approach that fits your situation. This determines the tone, deadline, and language of your demand letter.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {strategies.map((s) => {
          const isSelected = selected === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setSelected(s.id)}
              className={`card p-5 text-left transition-all ${s.color} ${isSelected ? 'ring-2 ring-blue-500 border-blue-400' : ''}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-semibold text-slate-900">{s.name}</span>
                    <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{s.deadline}</span>
                  </div>
                  <p className="text-sm text-slate-600 mb-3">{s.description}</p>
                  <ul className="space-y-1">
                    {s.bullets.map((b, i) => (
                      <li key={i} className="text-xs text-slate-500 flex items-center gap-1.5">
                        <span className="text-blue-400">•</span> {b}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 mt-0.5 shrink-0 ml-4 transition-all ${isSelected ? 'border-blue-500 bg-blue-500' : 'border-slate-300'}`}>
                  {isSelected && <div className="w-full h-full rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-white" />
                  </div>}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {selected && selected !== caseData.strategy && (
        <div className="flex justify-end">
          <button
            onClick={() => strategyMutation.mutate(selected)}
            disabled={strategyMutation.isPending}
            className="btn-primary btn-lg"
          >
            {strategyMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                Confirm Strategy
              </>
            )}
          </button>
        </div>
      )}

      {caseData.strategy && selected === caseData.strategy && (
        <div className="flex items-center gap-2 text-emerald-600 text-sm">
          <CheckCircle className="w-4 h-4" />
          Strategy confirmed: {STRATEGY_LABELS[caseData.strategy]}
        </div>
      )}
    </div>
  );
}

function LetterTab({ caseData }: { caseData: Case }) {
  const queryClient = useQueryClient();
  const [showHtml, setShowHtml] = useState(true);

  const generateMutation = useMutation({
    mutationFn: () => generateLetter(caseData.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case', caseData.id] });
      queryClient.invalidateQueries({ queryKey: ['cases'] });
    },
  });

  const logActionMutation = useMutation({
    mutationFn: (type: string) => logAction(caseData.id, type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case', caseData.id] });
      queryClient.invalidateQueries({ queryKey: ['cases'] });
    },
  });

  const canGenerate = caseData.strategy && !['ANALYZING', 'GENERATING', 'DRAFT'].includes(caseData.status);

  const handleDownload = () => {
    const content = caseData.demandLetter || '';
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `demand-letter-${caseData.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!canGenerate) {
    return (
      <div className="card p-8 text-center">
        <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <h3 className="font-semibold text-slate-900 mb-2">Select a Strategy First</h3>
        <p className="text-sm text-slate-500">Choose a recovery strategy before generating your demand letter.</p>
      </div>
    );
  }

  if (!caseData.demandLetter) {
    return (
      <div className="space-y-4">
        <div className="card p-8 text-center">
          <FileText className="w-12 h-12 text-blue-200 mx-auto mb-4" />
          <h3 className="font-semibold text-slate-900 mb-2">Generate Your Demand Letter</h3>
          <p className="text-sm text-slate-500 max-w-sm mx-auto mb-6">
            The system will assemble a professional demand letter based on your case facts and selected strategy using modular legal blocks.
          </p>
          {caseData.strategy && (
            <div className="inline-block mb-6 px-3 py-1.5 bg-blue-50 text-blue-700 text-sm rounded-lg font-medium">
              Strategy: {STRATEGY_LABELS[caseData.strategy]}
            </div>
          )}
          <div className="flex justify-center">
            <button
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              className="btn-primary btn-lg"
            >
              {generateMutation.isPending ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Generating Letter...
                </>
              ) : (
                <>
                  <FileText className="w-5 h-5" />
                  Generate Demand Letter
                </>
              )}
            </button>
          </div>
          {generateMutation.isError && (
            <div className="text-red-500 text-sm mt-3 text-left bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="font-medium mb-1">Generation failed</div>
              <div className="text-xs text-red-400 font-mono break-all">
                {(generateMutation.error as { response?: { data?: { details?: string; error?: string } } })?.response?.data?.details ||
                 (generateMutation.error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
                 (generateMutation.error as Error)?.message ||
                 'Unknown error'}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHtml(true)}
            className={`btn-sm ${showHtml ? 'btn-primary' : 'btn-secondary'}`}
          >
            Formatted
          </button>
          <button
            onClick={() => setShowHtml(false)}
            className={`btn-sm ${!showHtml ? 'btn-primary' : 'btn-secondary'}`}
          >
            Plain Text
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleDownload} className="btn-secondary btn-sm">
            <Download className="w-4 h-4" />
            Download
          </button>
          <button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            className="btn-secondary btn-sm"
          >
            {generateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Regenerate'}
          </button>
        </div>
      </div>

      {/* Letter */}
      <div className="card p-8 max-w-3xl">
        {showHtml && caseData.demandLetterHtml ? (
          <div
            className="prose prose-sm max-w-none text-slate-800 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: caseData.demandLetterHtml }}
          />
        ) : (
          <pre className="whitespace-pre-wrap font-mono text-sm text-slate-800 leading-relaxed">
            {caseData.demandLetter}
          </pre>
        )}
      </div>

      {/* Next Actions */}
      <div className="card p-5">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Next Actions</div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => logActionMutation.mutate('EMAIL_SENT')}
            className="btn-secondary btn-sm"
          >
            <Send className="w-4 h-4" />
            Mark as Email Sent
          </button>
          <button
            onClick={() => logActionMutation.mutate('CERTIFIED_MAIL_SENT')}
            className="btn-secondary btn-sm"
          >
            <Send className="w-4 h-4" />
            Mark as Certified Mail Sent
          </button>
          <button
            onClick={() => logActionMutation.mutate('PAYMENT_RECEIVED')}
            className="btn-secondary btn-sm text-emerald-600 border-emerald-200 hover:bg-emerald-50"
          >
            <CheckCircle className="w-4 h-4" />
            Payment Received
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-3">
          Logging actions updates the case status and timeline. For certified mail, use your local post office or a mailing service.
        </p>
      </div>
    </div>
  );
}

function TimelineTab({ caseData }: { caseData: Case }) {
  const timeline = (caseData.caseTimeline as Array<{ date: string; event: string; source?: string }>) || [];
  const actions = caseData.actions || [];

  return (
    <div className="space-y-6">
      {/* AI-reconstructed timeline */}
      {timeline.length > 0 && (
        <div>
          <h3 className="font-semibold text-slate-900 mb-4">Dispute Timeline (AI Reconstructed)</h3>
          <div className="relative">
            <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-200" />
            <div className="space-y-4">
              {timeline.map((item, i) => (
                <div key={i} className="flex items-start gap-4 pl-10 relative">
                  <div className="absolute left-3 top-1.5 w-2.5 h-2.5 rounded-full bg-blue-500 border-2 border-white" />
                  <div>
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      {item.date && item.date !== 'unknown' ? formatDate(item.date) : 'Date unknown'}
                    </div>
                    <div className="text-sm text-slate-800 mt-0.5">{item.event}</div>
                    {item.source && (
                      <div className="text-xs text-slate-400 mt-0.5">Source: {item.source}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Case actions log */}
      <div>
        <h3 className="font-semibold text-slate-900 mb-4">Case Activity Log</h3>
        <div className="space-y-2">
          {actions.length === 0 ? (
            <p className="text-sm text-slate-400">No activity logged yet.</p>
          ) : (
            actions.map((action) => (
              <div key={action.id} className="flex items-start gap-3 py-3 border-b border-slate-100 last:border-0">
                <div className="w-2 h-2 rounded-full bg-slate-300 mt-2 shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-800">
                      {action.label || action.type.replace(/_/g, ' ').toLowerCase()}
                    </span>
                    <span className="text-xs text-slate-400">{formatDate(action.createdAt)}</span>
                  </div>
                  {action.notes && <p className="text-xs text-slate-500 mt-0.5">{action.notes}</p>}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function CaseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  const { data: caseData, isLoading, error, refetch } = useQuery({
    queryKey: ['case', id],
    queryFn: () => getCase(id!),
    refetchInterval: (query) => {
      const data = (query as unknown as { state: { data: Case } }).state?.data;
      if (!data) return false;
      return ['ANALYZING', 'GENERATING'].includes(data.status) ? 3000 : false;
    },
  });

  const handleRefresh = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ['cases'] });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error || !caseData) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-500">Failed to load case.</p>
        <button onClick={() => navigate('/')} className="btn-secondary mt-4">Back to Dashboard</button>
      </div>
    );
  }

  const isProcessing = ['ANALYZING', 'GENERATING'].includes(caseData.status);

  return (
    <div className="p-4 lg:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm mb-3 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              All Cases
            </button>
            <h1 className="text-xl font-bold text-slate-900">{caseData.title || 'Untitled Case'}</h1>
            <div className="flex items-center gap-3 mt-1.5">
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[caseData.status]}`}>
                {isProcessing && <Loader2 className="w-3 h-3 animate-spin mr-1.5" />}
                {STATUS_LABELS[caseData.status]}
              </span>
              {caseData.strategy && (
                <span className="text-xs text-slate-500">
                  Strategy: {STRATEGY_LABELS[caseData.strategy]}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0 border-b border-slate-200 mb-6 overflow-x-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  active
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        {activeTab === 'overview' && <OverviewTab caseData={caseData} />}
        {activeTab === 'evidence' && <EvidenceTab caseData={caseData} onRefresh={handleRefresh} />}
        {activeTab === 'strategy' && <StrategyTab caseData={caseData} />}
        {activeTab === 'letter' && <LetterTab caseData={caseData} />}
        {activeTab === 'timeline' && <TimelineTab caseData={caseData} />}
      </div>
    </div>
  );
}
