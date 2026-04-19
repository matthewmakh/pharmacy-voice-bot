import { useState } from 'react';
import { Loader2, Zap } from 'lucide-react';
import { assessStrategy, type StrategyAssessment } from '../../../lib/api';
import { STRATEGY_LABELS } from '../../../lib/utils';
import type { Case } from '../../../types';
import SectionCard from '../../../components/ui/SectionCard';
import Badge from '../../../components/ui/Badge';
import Alert from '../../../components/ui/Alert';

export default function RefineStrategyPanel({ caseData }: { caseData: Case }) {
  const [assessment, setAssessment] = useState<StrategyAssessment | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const hasResearch = !!(caseData.acrisResult || caseData.courtHistory || caseData.entityResult ||
    caseData.uccResult || caseData.ecbResult || caseData.pacerResult);

  if (!hasResearch) return null;

  const handleRefine = async () => {
    setLoading(true);
    setErr(null);
    try {
      setAssessment(await assessStrategy(caseData.id));
    } catch {
      setErr('Assessment failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SectionCard
      title="Refine Strategy with Debtor Research"
      description="Use Claude to reason through assets, bankruptcy risk, entity type, and litigation history."
      collapsible
      defaultOpen={!assessment}
      action={
        <button
          onClick={handleRefine}
          disabled={loading}
          className="btn-primary text-sm"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          {loading ? 'Analyzing…' : 'Refine'}
        </button>
      }
    >
      {err && <Alert tone="danger">{err}</Alert>}
      {assessment ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="kbd-label">Recommended:</span>
            <Badge tone="info" size="lg">
              {STRATEGY_LABELS[assessment.strategy] ?? assessment.strategy}
            </Badge>
          </div>
          <p className="text-sm text-slate-700 leading-relaxed">{assessment.reasoning}</p>
          {assessment.keyFactors.length > 0 && (
            <div>
              <div className="kbd-label mb-1.5">Key Factors</div>
              <ul className="space-y-1">
                {assessment.keyFactors.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-slate-600">
                    <span className="text-slate-300 font-bold mt-0.5 shrink-0">—</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-slate-400 italic">This is a recommendation — you still select the final strategy below.</p>
        </div>
      ) : !err ? (
        <p className="text-xs text-slate-500 leading-relaxed">
          You have debtor research results on file. Click <strong>Refine</strong> to get a Claude-backed strategy recommendation.
        </p>
      ) : null}
    </SectionCard>
  );
}
