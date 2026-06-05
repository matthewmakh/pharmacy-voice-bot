import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, ArrowRight, AlertCircle, TrendingUp, DollarSign, CheckCircle2, FileText } from 'lucide-react';
import { getCases } from '../lib/api';
import { formatCurrency, STATUS_LABELS } from '../lib/utils';
import StatusPill from '../components/ui/StatusPill';
import EmptyState from '../components/ui/EmptyState';
import Alert from '../components/ui/Alert';
import type { CaseListItem, CaseStatus } from '../types';

function StatCard({ label, value, icon: Icon, accent }: { label: string; value: string | number; icon: React.ElementType; accent: string }) {
  return (
    <div className="card p-5 transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-muted-foreground font-medium">{label}</div>
          <div className="text-xl sm:text-2xl font-semibold text-foreground mt-1 tracking-tight truncate">{value}</div>
        </div>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${accent}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
}

// Group every case by whose move it is — so the home screen points you at the right case.
type Group = 'action' | 'waiting' | 'resolved';
const GROUP_OF: Record<CaseStatus, Group> = {
  DRAFT: 'action',
  ASSEMBLING: 'action',
  STRATEGY_PENDING: 'action',
  STRATEGY_SELECTED: 'action',
  READY: 'action',
  ESCALATING: 'action',
  ANALYZING: 'waiting',
  GENERATING: 'waiting',
  SENT: 'waiting',
  AWAITING_RESPONSE: 'waiting',
  RESOLVED: 'resolved',
  CLOSED: 'resolved',
};
const ACTION_LABEL: Partial<Record<CaseStatus, string>> = {
  ASSEMBLING: 'Run analysis',
  STRATEGY_PENDING: 'Choose a strategy',
  STRATEGY_SELECTED: 'Generate demand letter',
  READY: 'Send the demand letter',
  ESCALATING: 'Continue escalation',
};
const WAITING_LABEL: Partial<Record<CaseStatus, string>> = {
  ANALYZING: 'Analyzing…',
  GENERATING: 'Generating…',
  SENT: 'Awaiting debtor response',
  AWAITING_RESPONSE: 'Awaiting debtor response',
};

function CaseRow({ caseItem }: { caseItem: CaseListItem }) {
  const navigate = useNavigate();
  const outstanding = parseFloat(caseItem.amountOwed || '0') - parseFloat(caseItem.amountPaid || '0');
  const group = GROUP_OF[caseItem.status];

  return (
    <button
      onClick={() => navigate(`/cases/${caseItem.id}`)}
      className="group w-full flex items-center gap-3 px-4 sm:px-5 py-4 text-left hover:bg-muted/60 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground truncate">{caseItem.title || 'Untitled Case'}</div>
        <div className="text-xs text-muted-foreground mt-0.5 truncate">
          {caseItem.debtorBusiness || caseItem.debtorName || '—'}
          {outstanding > 0 && <span className="text-muted-foreground"> · {formatCurrency(outstanding)}</span>}
        </div>
      </div>
      {group === 'action' && (
        <span className="hidden sm:inline-flex items-center rounded-full bg-accent text-accent-foreground ring-1 ring-primary/20 px-2.5 py-1 text-xs font-medium whitespace-nowrap">
          {ACTION_LABEL[caseItem.status] ?? 'Open case'}
        </span>
      )}
      {group === 'waiting' && (
        <span className="hidden sm:block text-xs text-muted-foreground whitespace-nowrap">
          {WAITING_LABEL[caseItem.status] ?? STATUS_LABELS[caseItem.status]}
        </span>
      )}
      {group === 'resolved' && <StatusPill status={caseItem.status} />}
      <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-foreground group-hover:translate-x-0.5 transition-all shrink-0" />
    </button>
  );
}

function CaseGroup({ title, dot, cases }: { title: string; dot: string; cases: CaseListItem[] }) {
  if (cases.length === 0) return null;
  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span className="text-xs font-medium text-muted-foreground bg-muted rounded-full px-2 py-0.5">{cases.length}</span>
      </div>
      <div className="card divide-y divide-border overflow-hidden">
        {cases.map((c) => <CaseRow key={c.id} caseItem={c} />)}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [limit, setLimit] = useState(50);
  const { data: allCases = [], isLoading, error } = useQuery({
    queryKey: ['cases', limit],
    queryFn: () => getCases(limit),
    // Only poll while something is actually in progress — otherwise the dashboard
    // refetched every 10s indefinitely (battery/quota drain during office hours).
    refetchInterval: (query) => {
      const data = query.state.data ?? [];
      const busy = data.some((c) => c.status === 'ANALYZING' || c.status === 'GENERATING');
      return busy ? 5000 : false;
    },
  });
  const mayHaveMore = allCases.length >= limit;

  // Hide unfinished drafts (cases the user started uploading to but never submitted).
  const cases = allCases.filter((c) => c.status !== 'DRAFT');

  const activeCount = cases.filter((c) => !['RESOLVED', 'CLOSED'].includes(c.status)).length;
  const pendingActionCount = cases.filter((c) => GROUP_OF[c.status] === 'action').length;
  const resolvedCount = cases.filter((c) => ['RESOLVED', 'CLOSED'].includes(c.status)).length;
  const totalOutstanding = cases.reduce((sum, c) => {
    const owed = parseFloat(c.amountOwed || '0');
    const paid = parseFloat(c.amountPaid || '0');
    return sum + Math.max(0, owed - paid);
  }, 0);

  const groups = {
    action: cases.filter((c) => GROUP_OF[c.status] === 'action'),
    waiting: cases.filter((c) => GROUP_OF[c.status] === 'waiting'),
    resolved: cases.filter((c) => GROUP_OF[c.status] === 'resolved'),
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground text-sm">Loading cases…</div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">Cases</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your business collections matters</p>
        </div>
        <button onClick={() => navigate('/cases/new')} className="btn-primary btn-lg shrink-0">
          <Plus className="w-4 h-4" />
          New Case
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Active Cases" value={activeCount} icon={TrendingUp} accent="bg-primary/10 text-primary" />
        <StatCard label="Needs Attention" value={pendingActionCount} icon={AlertCircle} accent="bg-warning/10 text-warning" />
        <StatCard label="Total Outstanding" value={formatCurrency(totalOutstanding)} icon={DollarSign} accent="bg-foreground/5 text-foreground/70" />
        <StatCard label="Resolved" value={resolvedCount} icon={CheckCircle2} accent="bg-success/10 text-success" />
      </div>

      {error && (
        <div className="mb-6">
          <Alert tone="danger">Failed to load cases. Please refresh.</Alert>
        </div>
      )}

      {/* Grouped cases — by whose move it is */}
      {cases.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<FileText className="w-6 h-6" />}
            title="No cases yet"
            description="Create your first collections case to get started. Upload documents and let the platform organize your matter."
            action={
              <button onClick={() => navigate('/cases/new')} className="btn-primary">
                <Plus className="w-4 h-4" />
                Create First Case
              </button>
            }
          />
        </div>
      ) : (
        <>
          <CaseGroup title="Needs your action" dot="bg-primary" cases={groups.action} />
          <CaseGroup title="Waiting" dot="bg-warning" cases={groups.waiting} />
          <CaseGroup title="Resolved" dot="bg-success" cases={groups.resolved} />
        </>
      )}

      {mayHaveMore && (
        <div className="flex justify-center mt-4">
          <button onClick={() => setLimit((l) => l + 50)} className="btn-secondary text-sm">
            Load more cases
          </button>
        </div>
      )}
    </div>
  );
}
