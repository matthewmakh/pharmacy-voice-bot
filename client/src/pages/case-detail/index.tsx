import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, BookOpen, ChevronDown, BarChart3, Scale, Clock } from 'lucide-react';
import { getCase } from '../../lib/api';
import { formatCurrency, STRATEGY_LABELS } from '../../lib/utils';
import type { Case } from '../../types';
import { cn } from '../../lib/utils';
import StatusPill from '../../components/ui/StatusPill';
import Alert from '../../components/ui/Alert';
import EmptyState from '../../components/ui/EmptyState';
import { RotatingFact } from './shared/RotatingFact';
import StageRail, { type RailStage, type StageState } from './StageRail';
import OverviewTab from './OverviewTab';
import EvidenceTab from './EvidenceTab';
import StrategyTab from './StrategyTab';
import LetterTab from './LetterTab';
import EscalationTab from './EscalationTab';
import FilingGuideTab from './FilingGuideTab';
import TimelineTab from './TimelineTab';

// Stop polling for a document that has been "analyzing" longer than this — it's stuck
// (e.g. a server restart mid-job), and indefinite polling drains battery/quota.
const DOC_POLL_MAX_AGE_MS = 10 * 60 * 1000;

const ANALYSIS_DONE_STATUSES: Case['status'][] = ['STRATEGY_PENDING', 'STRATEGY_SELECTED', 'GENERATING', 'READY', 'SENT', 'AWAITING_RESPONSE', 'ESCALATING', 'RESOLVED', 'CLOSED'];
const POST_LETTER_STATUSES: Case['status'][] = ['SENT', 'AWAITING_RESPONSE', 'ESCALATING', 'RESOLVED', 'CLOSED'];

// ─── Workflow stages (the guided spine) ─────────────────────────────────────────
// The 5 stages map onto the existing tab components; nothing is removed — reference
// material (case details, filing guide, timeline) lives behind "Reference & History".
type Stage = 'intake' | 'analysis' | 'strategy' | 'demand' | 'escalate';
type RefView = 'overview' | 'filing' | 'timeline';
type View = Stage | RefView;

const STAGE_ORDER: Stage[] = ['intake', 'analysis', 'strategy', 'demand', 'escalate'];
const STAGE_META: Record<Stage, { label: string; n: number }> = {
  intake: { label: 'Intake', n: 1 },
  analysis: { label: 'Analysis', n: 2 },
  strategy: { label: 'Strategy', n: 3 },
  demand: { label: 'Demand', n: 4 },
  escalate: { label: 'Escalate & File', n: 5 },
};
const REF_META: Record<RefView, { label: string; icon: typeof BarChart3 }> = {
  overview: { label: 'Case details', icon: BarChart3 },
  filing: { label: 'NY Filing Guide', icon: Scale },
  timeline: { label: 'Timeline & history', icon: Clock },
};

const isStage = (v: View): v is Stage => (STAGE_ORDER as string[]).includes(v);

function signals(c: Case) {
  return {
    hasDocs: c.documents.length > 0,
    hasAnalysis: !!c.caseStrength || ANALYSIS_DONE_STATUSES.includes(c.status),
    hasStrategy: !!c.strategy,
    hasLetter: !!c.demandLetterHtml,
    isPostLetter: POST_LETTER_STATUSES.includes(c.status),
    isResolved: c.status === 'RESOLVED' || c.status === 'CLOSED',
    analyzing: c.status === 'ANALYZING',
  };
}

// Stage gating — same signals as the previous tab gating, expressed as done/current/locked.
function stageStates(c: Case): Record<Stage, StageState> {
  const s = signals(c);
  return {
    intake: s.hasDocs || s.hasAnalysis ? 'done' : 'current',
    analysis: s.hasAnalysis ? 'done' : s.hasDocs || s.analyzing ? 'current' : 'locked',
    strategy: s.hasStrategy ? 'done' : s.hasAnalysis ? 'current' : 'locked',
    demand: s.isPostLetter || s.isResolved ? 'done' : s.hasStrategy || s.hasLetter ? 'current' : 'locked',
    escalate: s.isResolved ? 'done' : s.isPostLetter ? 'current' : 'locked',
  };
}

function currentStage(c: Case): Stage {
  const st = stageStates(c);
  return STAGE_ORDER.find((s) => st[s] === 'current') ?? 'escalate';
}

function stageSub(id: Stage, c: Case): string | undefined {
  const s = signals(c);
  switch (id) {
    case 'intake':
      return s.hasDocs ? `${c.documents.length} document${c.documents.length !== 1 ? 's' : ''}` : 'Add evidence';
    case 'analysis':
      return s.analyzing ? 'Analyzing…' : s.hasAnalysis && c.caseStrength ? `${c.caseStrength[0].toUpperCase()}${c.caseStrength.slice(1)} case` : 'Run analysis';
    case 'strategy':
      return s.hasStrategy && c.strategy ? STRATEGY_LABELS[c.strategy] : s.hasAnalysis ? 'Pick an approach' : undefined;
    case 'demand':
      return s.isPostLetter ? 'Sent' : s.hasLetter ? 'Ready to send' : s.hasStrategy ? 'Generate letter' : undefined;
    case 'escalate':
      return s.isResolved ? 'Resolved' : s.isPostLetter ? 'In progress' : undefined;
  }
}

// The single "what do I do now" nudge (unchanged logic), returning a target stage.
function nextStep(c: Case): { view: View; title: string; cta: string } | null {
  if (c.status === 'ANALYZING' || c.status === 'GENERATING') return null;
  const s = signals(c);
  if (!s.hasDocs && !s.hasAnalysis) return { view: 'intake', title: 'Add your evidence to get started', cta: 'Upload documents' };
  if (!s.hasAnalysis) return { view: 'analysis', title: 'Run the AI analysis to assess your case', cta: 'Run analysis' };
  if (!c.strategy) return { view: 'strategy', title: 'Choose how aggressively to pursue this debt', cta: 'Choose a strategy' };
  if (!c.demandLetterHtml) return { view: 'demand', title: 'Generate your demand letter', cta: 'Generate letter' };
  if (c.status === 'READY') return { view: 'demand', title: 'Send the demand letter to the debtor', cta: 'Open demand letter' };
  if (c.status === 'SENT' || c.status === 'AWAITING_RESPONSE') return { view: 'escalate', title: 'No response yet? Start escalating toward filing', cta: 'Go to Escalation' };
  if (c.status === 'ESCALATING') return { view: 'escalate', title: 'Continue the court process', cta: 'Go to Escalation' };
  return null;
}

export default function CaseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [view, setView] = useState<View | null>(null);
  const [refOpen, setRefOpen] = useState(false);

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

  // If the selected stage becomes locked (e.g. analysis was reset), fall back to the
  // current stage — same safety as the previous "fall back to Overview".
  useEffect(() => {
    if (caseData && view && isStage(view) && stageStates(caseData)[view] === 'locked') {
      setView(currentStage(caseData));
    }
  }, [caseData, view]);

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
  const debtor = caseData.debtorBusiness || caseData.debtorName;
  const step = nextStep(caseData);
  const activeView: View = view ?? currentStage(caseData);
  const activeStage = isStage(activeView) ? activeView : null;

  const states = stageStates(caseData);
  const stages: RailStage<Stage>[] = STAGE_ORDER.map((id) => ({
    id,
    label: STAGE_META[id].label,
    n: STAGE_META[id].n,
    state: states[id],
    sub: stageSub(id, caseData),
  }));

  return (
    <div className="max-w-5xl mx-auto p-4 lg:p-8 animate-fade-in">
      {/* Header — persistent case context */}
      <div className="flex items-start gap-3 mb-6 pb-5 border-b border-border">
        <button onClick={() => navigate('/')} className="p-2 -ml-2 text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-muted shrink-0" aria-label="Back to cases">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground truncate">
            {caseData.title || `Case #${caseData.id.slice(0, 8)}`}
          </h1>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <StatusPill status={caseData.status} />
            {debtor && <span className="text-xs text-muted-foreground">· {debtor}</span>}
            {outstanding > 0 && <span className="text-xs text-muted-foreground">· {formatCurrency(outstanding)} outstanding</span>}
          </div>
        </div>

        {/* Reference & History — case details, filing guide, timeline (one click away) */}
        <div className="relative shrink-0">
          <button
            onClick={() => setRefOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground rounded-lg px-2.5 py-1.5 hover:bg-muted transition-colors"
          >
            <BookOpen className="w-4 h-4" />
            <span className="hidden sm:inline">Reference &amp; History</span>
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          {refOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setRefOpen(false)} />
              <div className="absolute right-0 mt-1 w-52 z-20 card p-1 shadow-md">
                {(Object.keys(REF_META) as RefView[]).map((rv) => {
                  const Icon = REF_META[rv].icon;
                  return (
                    <button
                      key={rv}
                      onClick={() => { setView(rv); setRefOpen(false); }}
                      className={cn(
                        'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-left transition-colors hover:bg-muted',
                        activeView === rv ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground',
                      )}
                    >
                      <Icon className="w-4 h-4 text-muted-foreground" />
                      {REF_META[rv].label}
                    </button>
                  );
                })}
              </div>
            </>
          )}
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

      {/* Stage rail — the progress spine */}
      <div className="mb-6">
        <StageRail stages={stages} activeId={activeStage} onSelect={(s) => setView(s)} />
      </div>

      {/* Single "do this next" nudge */}
      {step && step.view !== activeView && (
        <div className="mb-6">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-primary/30 bg-accent px-4 py-3.5">
            <div className="text-sm text-accent-foreground">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-primary block">Do this next</span>
              <span className="font-medium text-foreground">{step.title}</span>
            </div>
            <button onClick={() => setView(step.view)} className="btn-primary text-sm whitespace-nowrap">
              {step.cta} <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Current workspace heading */}
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          {activeStage ? `Step ${STAGE_META[activeStage].n} · ${STAGE_META[activeStage].label}` : REF_META[activeView as RefView].label}
        </h2>
      </div>

      {/* Workspace — the existing tab components, unchanged */}
      {activeView === 'intake' && <EvidenceTab caseData={caseData} onRefresh={refetch} />}
      {(activeView === 'analysis' || activeView === 'strategy') && <StrategyTab caseData={caseData} />}
      {activeView === 'demand' && <LetterTab caseData={caseData} />}
      {activeView === 'escalate' && <EscalationTab caseData={caseData} />}
      {activeView === 'overview' && <OverviewTab caseData={caseData} />}
      {activeView === 'filing' && <FilingGuideTab caseData={caseData} />}
      {activeView === 'timeline' && <TimelineTab caseData={caseData} />}
    </div>
  );
}
