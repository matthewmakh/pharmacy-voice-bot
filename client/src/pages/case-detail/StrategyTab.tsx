import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, CheckCircle2, CircleDashed, Sparkles, TrendingUp, TrendingDown } from 'lucide-react';
import {
  analyzeCase,
  setStrategy,
  resetAnalysis,
} from '../../lib/api';
import { STRENGTH_TONES } from '../../lib/utils';
import type { Case, Strategy, CaseAssessment } from '../../types';
import SectionCard from '../../components/ui/SectionCard';
import Alert from '../../components/ui/Alert';
import Badge from '../../components/ui/Badge';
import { RotatingFact } from './shared/RotatingFact';
import { VerificationPanel } from './shared/VerificationPanel';
import { solForCase, SOL_STATUS_TONE } from './shared/sol';
import AcrisLookup from './strategy/AcrisLookup';
import CourtHistoryLookup from './strategy/CourtHistoryLookup';
import NysEntityLookup from './strategy/NysEntityLookup';
import UccLookup from './strategy/UccLookup';
import EcbLookup from './strategy/EcbLookup';
import PacerLookup from './strategy/PacerLookup';
import RefineStrategyPanel from './strategy/RefineStrategyPanel';

const THEORY_LABELS: Record<string, string> = {
  breach_of_written_contract: 'Breach of Written Contract',
  breach_of_oral_contract: 'Breach of Oral Contract',
  account_stated: 'Account Stated',
  quantum_meruit: 'Quantum Meruit',
};

const STRATEGIES: { id: Strategy; title: string; description: string; traits: string[] }[] = [
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

// The AI returns counterclaim signals prefixed "RISK-ELEVATING:" / "RISK-REDUCING:".
// Split them so what hurts vs. helps the case is obvious instead of one flat list.
function categorizeSignals(signals: string[]) {
  const strip = (s: string) => s.replace(/^\s*RISK-(ELEVATING|REDUCING)\s*[:\-—]*\s*/i, '').trim();
  const up: string[] = [];
  const down: string[] = [];
  const other: string[] = [];
  for (const s of signals) {
    if (/^\s*RISK-ELEVATING/i.test(s)) up.push(strip(s));
    else if (/^\s*RISK-REDUCING/i.test(s)) down.push(strip(s));
    else other.push(s);
  }
  return { up, down, other };
}

function SignalGroup({ items, variant }: { items: string[]; variant: 'up' | 'down' }) {
  if (items.length === 0) return null;
  const up = variant === 'up';
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <div className={`rounded-lg border p-3 ${up ? 'border-red-200 bg-red-50/70' : 'border-emerald-200 bg-emerald-50/70'}`}>
      <div className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide mb-2 ${up ? 'text-red-700' : 'text-emerald-700'}`}>
        <Icon className="w-3.5 h-3.5" /> {up ? 'Raises risk' : 'Reduces risk'}
        <span className={`ml-auto rounded-full px-1.5 text-[10px] font-semibold ${up ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>{items.length}</span>
      </div>
      <ul className="space-y-1.5">
        {items.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-xs leading-relaxed">
            <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${up ? 'bg-red-400' : 'bg-emerald-500'}`} />
            <span className={up ? 'text-red-900/90' : 'text-emerald-900/90'}>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function StrategyTab({ caseData }: { caseData: Case }) {
  const queryClient = useQueryClient();
  const analyzeClickedAt = React.useRef<Date | null>(null);

  const analyzeMutation = useMutation({
    mutationFn: () => { analyzeClickedAt.current = new Date(); return analyzeCase(caseData.id); },
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

  const needsAnalysis = !caseData.caseStrength && !['ANALYZING'].includes(caseData.status);
  const isAnalyzing = caseData.status === 'ANALYZING' || analyzeMutation.isPending;
  const isStuckAnalyzing =
    caseData.status === 'ANALYZING' &&
    !analyzeMutation.isPending &&
    Date.now() - new Date(caseData.updatedAt).getTime() > 2 * 60 * 1000;

  const analysisStartedAt: Date | undefined = isAnalyzing
    ? caseData.status === 'ANALYZING'
      ? new Date(caseData.updatedAt)
      : (analyzeClickedAt.current ?? undefined)
    : undefined;
  const analysisEstimatedSeconds = 20 + caseData.documents.length * 12;

  const a = caseData.caseAssessment as CaseAssessment | null;
  const sol = solForCase(caseData);

  return (
    <div className="space-y-6">
      {needsAnalysis && (
        <SectionCard padding="lg">
          <div className="text-center py-4">
            <Sparkles className="w-8 h-8 text-blue-500 mx-auto mb-3" />
            <div className="text-sm font-semibold text-foreground mb-1">Run AI Analysis</div>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto leading-relaxed">
              Analyze your case to get a strength assessment, evidence summary, and strategy recommendations.
            </p>
            <button
              onClick={() => analyzeMutation.mutate()}
              disabled={analyzeMutation.isPending}
              className="btn-primary"
            >
              {analyzeMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Run AI Analysis
            </button>
            {analyzeMutation.isError && (
              <div className="mt-4 max-w-md mx-auto">
                <Alert tone="danger">
                  {(analyzeMutation.error as { response?: { data?: { error?: string } } })?.response?.data?.error
                    ?? String(analyzeMutation.error)}
                </Alert>
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {isAnalyzing && !isStuckAnalyzing && (
        <RotatingFact
          label="Analyzing your case…"
          startedAt={analysisStartedAt}
          estimatedSeconds={analysisEstimatedSeconds}
        />
      )}

      {isStuckAnalyzing && (
        <Alert
          tone="warning"
          title="Analysis appears stuck"
          actions={
            <button
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending}
              className="btn-secondary text-sm"
            >
              {resetMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Reset & Try Again
            </button>
          }
        >
          This case has been analyzing for more than 2 minutes. The server may have restarted mid-analysis.
        </Alert>
      )}

      {caseData.caseStrength && (
        <>
          {/* Disclaimer */}
          <Alert tone="neutral">
            <span className="text-xs">
              AI-assisted analysis — legal framework is grounded in NY law, but element-by-element assessment is based on AI reasoning from your documents. Not a legal opinion.
            </span>
          </Alert>

          {/* Strength + reset */}
          <SectionCard
            title={
              <div className="flex items-center gap-3">
                <span>AI Case Assessment</span>
                <Badge tone={STRENGTH_TONES[caseData.caseStrength] ?? 'neutral'} size="lg">
                  {caseData.caseStrength.charAt(0).toUpperCase() + caseData.caseStrength.slice(1)} Case
                </Badge>
              </div>
            }
            action={
              <button
                onClick={() => resetMutation.mutate()}
                disabled={resetMutation.isPending}
                className="text-xs text-muted-foreground hover:text-red-500 transition-colors"
              >
                {resetMutation.isPending ? 'Resetting…' : 'Reset & Re-run'}
              </button>
            }
          >
            {caseData.caseSummary && (
              <p className="text-sm text-muted-foreground leading-relaxed">{caseData.caseSummary}</p>
            )}
            {a?.recommendedStrategy && (
              <p className="text-xs text-muted-foreground mt-3">
                AI recommends: <span className="font-semibold text-foreground">
                  {STRATEGIES.find(s => s.id === a.recommendedStrategy)?.title}
                </span>
              </p>
            )}
          </SectionCard>

          {/* Legal theory */}
          {a?.primaryCauseOfAction && (
            <SectionCard title="Legal Theory" collapsible defaultOpen>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-bold text-foreground">
                  {THEORY_LABELS[a.primaryCauseOfAction.theory] ?? a.primaryCauseOfAction.theory}
                </span>
                <Badge tone="neutral" size="sm">primary</Badge>
              </div>
              <p className="text-sm text-muted-foreground mb-3 leading-relaxed">{a.primaryCauseOfAction.reasoning}</p>
              <div className="space-y-1.5">
                {a.primaryCauseOfAction.elements.map((el, i) => (
                  <div key={i} className="flex items-start gap-2">
                    {el.satisfied ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    ) : (
                      <CircleDashed className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0 text-sm">
                      <span className="font-medium text-foreground">{el.element}</span>
                      {el.satisfied && el.evidence && (
                        <span className="text-muted-foreground ml-1">— {el.evidence}</span>
                      )}
                      {!el.satisfied && el.gap && (
                        <span className="text-red-600 ml-1">— {el.gap}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {a.alternativeCauses.length > 0 && (
                <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
                  Also plead in the alternative: {a.alternativeCauses.join(', ')}
                </p>
              )}
            </SectionCard>
          )}

          {/* Counterclaim risk + enforcement path + SOL */}
          <SectionCard title="Risk & Enforcement" collapsible defaultOpen>
            <div className="space-y-3">
              {a?.counterclaimRisk && (
                <Alert
                  tone={a.counterclaimRisk.level === 'high' ? 'danger' : a.counterclaimRisk.level === 'medium' ? 'warning' : 'success'}
                  title={
                    <div className="flex items-center gap-2">
                      <span>Counterclaim Risk</span>
                      <Badge
                        tone={a.counterclaimRisk.level === 'high' ? 'danger' : a.counterclaimRisk.level === 'medium' ? 'warning' : 'success'}
                        size="sm"
                      >
                        {a.counterclaimRisk.level.toUpperCase()}
                      </Badge>
                    </div>
                  }
                >
                  <p className="text-xs leading-relaxed mb-1.5">{a.counterclaimRisk.reasoning}</p>
                  {a.counterclaimRisk.signals.length > 0 && (() => {
                    const sig = categorizeSignals(a.counterclaimRisk.signals);
                    return (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                        <SignalGroup items={sig.up} variant="up" />
                        <SignalGroup items={sig.down} variant="down" />
                        {sig.other.length > 0 && (
                          <ul className="space-y-1 sm:col-span-2 mt-1">
                            {sig.other.map((s, i) => (
                              <li key={i} className="text-xs flex items-start gap-1.5">
                                <span className="shrink-0 opacity-60">—</span>{s}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })()}
                </Alert>
              )}

              {a?.debtorEntityNotes && (
                <Alert
                  tone="neutral"
                  title={
                    <div className="flex items-center gap-2">
                      <span>Enforcement Path</span>
                      <Badge tone="warning" size="sm">Entity unverified</Badge>
                    </div>
                  }
                >
                  <p className="text-xs leading-relaxed">{a.debtorEntityNotes}</p>
                </Alert>
              )}

              <Alert tone={SOL_STATUS_TONE[sol.status]} title="Statute of Limitations (CPLR §213)">
                <span className="text-xs">{sol.label}</span>
                {sol.status === 'expired' && (
                  <p className="text-xs mt-1 opacity-80">
                    The claim may be time-barred. Consult a NY-licensed attorney before taking any action.
                  </p>
                )}
              </Alert>

              {a?.strategyReasoning && (
                <Alert tone="info" title="Strategy Recommendation">
                  <p className="text-xs leading-relaxed">{a.strategyReasoning}</p>
                </Alert>
              )}
            </div>
          </SectionCard>

          {/* Debtor research lookups */}
          <SectionCard
            title="Debtor Research"
            description="Free public-records lookups. Each lookup result is saved to this case."
            collapsible
            defaultOpen={!(caseData.acrisResult || caseData.courtHistory || caseData.entityResult || caseData.uccResult || caseData.ecbResult || caseData.pacerResult)}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <AcrisLookup caseData={caseData} />
              <CourtHistoryLookup caseData={caseData} />
              <NysEntityLookup caseData={caseData} />
              <EcbLookup caseData={caseData} />
              <UccLookup caseData={caseData} />
              <PacerLookup caseData={caseData} />
            </div>
          </SectionCard>
        </>
      )}

      {caseData.caseAnalysisVerification && (
        <VerificationPanel verification={caseData.caseAnalysisVerification} title="Analysis Verification" />
      )}

      <RefineStrategyPanel caseData={caseData} />

      {/* Strategy selector */}
      <SectionCard
        title="Select Strategy"
        description={needsAnalysis ? 'Run AI analysis above to get a recommendation.' : undefined}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {STRATEGIES.map((s) => {
            const isSelected = caseData.strategy === s.id;
            const isRecommended = caseData.caseAssessment?.recommendedStrategy === s.id;
            const isGeneric = needsAnalysis && !isSelected;
            return (
              <button
                key={s.id}
                onClick={() => strategyMutation.mutate(s.id)}
                disabled={strategyMutation.isPending}
                className={`text-left p-5 rounded-xl border bg-card transition-all relative ${
                  isSelected
                    ? 'border-blue-500 ring-2 ring-blue-200 bg-blue-50/50'
                    : isGeneric
                    ? 'border-border opacity-60 hover:opacity-80'
                    : 'border-border hover:border-border hover:shadow-sm'
                }`}
              >
                {isRecommended && !isSelected && (
                  <span className="absolute top-3 right-3">
                    <Badge tone="info" size="sm">AI pick</Badge>
                  </span>
                )}
                <div className="text-sm font-semibold text-foreground mb-2 pr-16">{s.title}</div>
                <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{s.description}</p>
                <ul className="space-y-1">
                  {s.traits.map((t) => (
                    <li key={t} className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-blue-500' : 'bg-muted'}`} />
                      {t}
                    </li>
                  ))}
                </ul>
                {isSelected && (
                  <div className="mt-3 kbd-label text-blue-600">Selected</div>
                )}
              </button>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}
