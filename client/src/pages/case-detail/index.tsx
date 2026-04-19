import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, FileText, Upload, Zap, BarChart3, Clock, Shield, Scale,
} from 'lucide-react';
import { getCase } from '../../lib/api';
import { formatCurrency, STRATEGY_LABELS } from '../../lib/utils';
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

const TABS: TabItem<Tab>[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'evidence', label: 'Evidence', icon: Upload },
  { id: 'strategy', label: 'Strategy', icon: Zap },
  { id: 'letter', label: 'Demand Letter', icon: FileText },
  { id: 'escalation', label: 'Escalation', icon: Shield },
  { id: 'filing', label: 'NY Filing Guide', icon: Scale },
  { id: 'timeline', label: 'Timeline', icon: Clock },
];

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
      const analyzing = ['ANALYZING', 'GENERATING'].includes(data.status);
      const docsAnalyzing = data.documents.some((d) => d.classification === null);
      return analyzing || docsAnalyzing ? 3000 : false;
    },
  });

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
            action={
              <button onClick={() => navigate('/')} className="btn-secondary">
                Back to Cases
              </button>
            }
          />
        </div>
      </div>
    );
  }

  const outstanding = parseFloat(caseData.amountOwed || '0') - parseFloat(caseData.amountPaid || '0');

  return (
    <div className="max-w-5xl mx-auto p-4 lg:p-8">
      {/* Header */}
      <div className="flex items-start gap-3 mb-6 pb-5 border-b border-slate-200">
        <button
          onClick={() => navigate('/')}
          className="p-2 -ml-2 text-slate-400 hover:text-slate-600 transition-colors rounded-lg hover:bg-slate-100"
          aria-label="Back to cases"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-slate-900 truncate">
            {caseData.title || `Case #${caseData.id.slice(0, 8)}`}
          </h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <StatusPill status={caseData.status} />
            {caseData.strategy && (
              <span className="text-xs text-slate-500">
                {STRATEGY_LABELS[caseData.strategy]}
              </span>
            )}
            {outstanding > 0 && (
              <span className="text-xs text-slate-500">
                · {formatCurrency(outstanding)} outstanding
              </span>
            )}
          </div>
        </div>
      </div>

      {(caseData.status === 'ANALYZING' || caseData.status === 'GENERATING') && activeTab === 'overview' && (
        <div className="mb-6">
          <Alert tone="info">
            This case is currently {caseData.status === 'ANALYZING' ? 'being analyzed' : 'generating a document'}. The page will update automatically.
          </Alert>
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
