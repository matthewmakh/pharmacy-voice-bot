import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, FileText, Upload, Zap, BarChart3, Clock, Shield, Scale, ArrowRight,
} from 'lucide-react';
import { getCase } from '../../lib/api';
import { formatCurrency, STRATEGY_LABELS } from '../../lib/utils';
import type { Case } from '../../types';
import StatusPill from '../../components/ui/StatusPill';
import TabBar, { type TabItem } from '../../components/ui/TabBar';
import Alert from '../../components/ui/Alert';
import EmptyState from '../../components/ui/EmptyState';
import { RotatingFact } from './shared/RotatingFact';
import OverviewTab from './OverviewTab';
import EvidenceTab from './EvidenceTab';
import StrategyTab from './StrategyTab';
import LetterTab from './LetterTab';
import EscalationTab from './EscalationTab';
import FilingGuideTab from './FilingGuideTab';
import TimelineTab from './TimelineTab';

type Tab = 'overview' | 'evidence' | 'strategy' | 'letter' | 'escalation' | 'filing' | 'timeline';

// Stop polling for a document that has been "analyzing" longer than this — it's stuck
// (e.g. a server restart mid-job), and indefinite polling drains battery/quota.
const DOC_POLL_MAX_AGE_MS = 10 * 60 * 1000;

const ANALYSIS_DONE_STATUSES: Case['status'][] = ['STRATEGY_PENDING', 'STRATEGY_SELECTED', 'GENERATING', 'READY', 'SENT', 'AWAITING_RESPONSE', 'ESCALATING', 'RESOLVED', 'CLOSED'];
const POST_LETTER_STATUSES: Case['status'][] = ['SENT', 'AWAITING_RESPONSE', 'ESCALATING', 'RESOLVED', 'CLOSED'];

interface TabState { enabled: boolean; hint?: string }

function tabGating(c: Case): Record<Tab, TabState> {
  const hasAnalysis = !!c.caseStrength || ANALYSIS_DONE_STATUSES.includes(c.status);
  const hasStrategy = !!c.strategy;
  const hasLetter = !!c.demandLetterHtml;
  return {
    overview: { enabled: true },
    evidence: { enabled: true },
    strategy: { enabled: c.status !== 'DRAFT', hint: 'Available once the case is created' },
    letter: { enabled: hasStrategy || hasLetter, hint: 'Pick a strategy on the Strategy tab first' },
    escalation: { enabled: hasLetter || POST_LETTER_STATUSES.includes(c.status), hint: 'Generate a demand letter first' },
    filing: { enabled: true },
    timeline: { enabled: true },
  };
}

function nextStep(c: Case): { tab: Tab; title: string; cta: string } | null {
  if (c.status === 'ANALYZING' || c.status === 'GENERATING') return null;
  const hasAnalysis = !!c.caseStrength || ANALYSIS_DONE_STATUSES.includes(c.status);
  if (c.documents.length === 0 && !hasAnalysis) return { tab: 'evidence', title: 'Add your evidence to get started', cta: 'Upload documents' };
  if (!hasAnalysis) return { tab: 'strategy', title: 'Run the AI analysis to assess your case', cta: 'Go to Strategy' };
  if (!c.strategy) return { tab: 'strategy', title: 'Choose how aggressively to pursue this debt', cta: 'Choose a strategy' };
  if (!c.demandLetterHtml) return { tab: 'letter', title: 'Generate your demand letter', cta: 'Generate letter' };
  if (c.status === 'READY') return { tab: 'letter', title: 'Send the demand letter to the debtor', cta: 'Open demand letter' };
  if (c.status === 'SENT' || c.status === 'AWAITING_RESPONSE') return { tab: 'escalation', title: 'No response yet? Start escalating toward filing', cta: 'Go to Escalation' };
  if (c.status === 'ESCALATING') return { tab: 'escalation', title: 'Continue the court process', cta: 'Go to Escalation' };
  return null;
}

export default function CaseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  const { data: caseData, isLoading, error, refetch } = useQuery({
    queryKey: ['case', id],
    queryFn: () => getCase(id!),
    enabled: !!id,
    staleTime: 0,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const busy = data.status === 'ANALYZING' || data.status === 'GENERATING';
      const docsAnalyzing = data.documents.some(
        (d) => d.classification === null && !d.analysisError && Date.now() - new Date(d.uploadedAt).getTime() < DOC_POLL_MAX_AGE_MS,
      );
      const lookupRunning = Object.values(data.lookupMeta ?? {}).some((m) => m?.status === 'running');
      return busy || docsAnalyzing || lookupRunning ? 3000 : false;
    },
  });

  const gating = caseData ? tabGating(caseData) : null;

  // If the active tab becomes disabled (e.g. data reset), fall back to Overview.
  useEffect(() => {
    if (gating && !gating[activeTab].enabled) setActiveTab('overview');
  }, [gating, activeTab]);

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <RotatingFact label="Loading case…" />
      </div>
    );
  }

  if (error || !caseData) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <div className="card">
          <EmptyState
            title="Failed to load case"
            description="It may have been deleted or you may not have access."
            action={<button onClick={() => navigate('/')} className="btn-secondary">Back to Cases</button>}
          />
        </div>
      </div>
    );
  }

  const outstanding = parseFloat(caseData.amountOwed || '0') - parseFloat(caseData.amountPaid || '0');
  const step = nextStep(caseData);

  const TABS: TabItem<Tab>[] = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'evidence', label: 'Evidence', icon: Upload },
    { id: 'strategy', label: 'Strategy', icon: Zap, disabled: !gating!.strategy.enabled, disabledHint: gating!.strategy.hint },
    { id: 'letter', label: 'Demand Letter', icon: FileText, disabled: !gating!.letter.enabled, disabledHint: gating!.letter.hint },
    { id: 'escalation', label: 'Escalation', icon: Shield, disabled: !gating!.escalation.enabled, disabledHint: gating!.escalation.hint },
    { id: 'filing', label: 'NY Filing Guide', icon: Scale },
    { id: 'timeline', label: 'Timeline', icon: Clock },
  ];

  return (
    <div className="max-w-5xl mx-auto p-4 lg:p-8">
      {/* Header */}
      <div className="flex items-start gap-3 mb-6 pb-5 border-b border-slate-200">
        <button onClick={() => navigate('/')} className="p-2 -ml-2 text-slate-400 hover:text-slate-600 transition-colors rounded-lg hover:bg-slate-100" aria-label="Back to cases">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-slate-900 truncate">
            {caseData.title || `Case #${caseData.id.slice(0, 8)}`}
          </h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <StatusPill status={caseData.status} />
            {caseData.strategy && <span className="text-xs text-slate-500">{STRATEGY_LABELS[caseData.strategy]}</span>}
            {outstanding > 0 && <span className="text-xs text-slate-500">· {formatCurrency(outstanding)} outstanding</span>}
          </div>
        </div>
      </div>

      {/* In-progress banner */}
      {(caseData.status === 'ANALYZING' || caseData.status === 'GENERATING') && (
        <div className="mb-6">
          <Alert tone="info">
            This case is currently {caseData.status === 'ANALYZING' ? 'being analyzed' : 'generating a document'}. The page updates automatically — you can keep working or close this tab.
          </Alert>
        </div>
      )}

      {/* Next-step guide — the intelligent "what do I do now" nudge */}
      {step && (
        <div className="mb-6">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
            <div className="text-sm text-blue-900"><span className="font-semibold">Next step:</span> {step.title}</div>
            {activeTab !== step.tab && (
              <button onClick={() => setActiveTab(step.tab)} className="btn-primary text-sm whitespace-nowrap">
                {step.cta} <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="mb-6">
        <TabBar tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />
      </div>

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
