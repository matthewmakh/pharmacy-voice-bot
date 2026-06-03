import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, ArrowRight, AlertCircle, TrendingUp, DollarSign, CheckCircle2, FileText } from 'lucide-react';
import { getCases } from '../lib/api';
import { formatCurrency, formatDate } from '../lib/utils';
import StatusPill from '../components/ui/StatusPill';
import EmptyState from '../components/ui/EmptyState';
import Alert from '../components/ui/Alert';
import type { CaseListItem } from '../types';

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

function CaseRow({ caseItem }: { caseItem: CaseListItem }) {
  const navigate = useNavigate();
  const outstanding = parseFloat(caseItem.amountOwed || '0') - parseFloat(caseItem.amountPaid || '0');

  return (
    <tr
      className="group hover:bg-muted/60 cursor-pointer transition-colors"
      onClick={() => navigate(`/cases/${caseItem.id}`)}
    >
      <td className="px-6 py-4">
        <div className="font-medium text-foreground text-sm">
          {caseItem.title || 'Untitled Case'}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {caseItem.debtorBusiness || caseItem.debtorName || '—'}
        </div>
      </td>
      <td className="px-6 py-4">
        <StatusPill status={caseItem.status} />
      </td>
      <td className="px-6 py-4 text-sm text-foreground font-medium tabular-nums">
        {outstanding > 0 ? formatCurrency(outstanding) : '—'}
      </td>
      <td className="px-6 py-4 text-sm text-muted-foreground">
        {caseItem.documents.length} file{caseItem.documents.length !== 1 ? 's' : ''}
      </td>
      <td className="px-6 py-4 text-sm text-muted-foreground tabular-nums">
        {formatDate(caseItem.createdAt)}
      </td>
      <td className="px-6 py-4">
        <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
      </td>
    </tr>
  );
}

function CaseCard({ caseItem }: { caseItem: CaseListItem }) {
  const navigate = useNavigate();
  const outstanding = parseFloat(caseItem.amountOwed || '0') - parseFloat(caseItem.amountPaid || '0');

  return (
    <button
      onClick={() => navigate(`/cases/${caseItem.id}`)}
      className="card p-4 w-full text-left transition-shadow hover:shadow-md active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-foreground text-sm truncate">{caseItem.title || 'Untitled Case'}</div>
          <div className="text-xs text-muted-foreground mt-0.5 truncate">
            {caseItem.debtorBusiness || caseItem.debtorName || '—'}
          </div>
        </div>
        <StatusPill status={caseItem.status} />
      </div>
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border text-sm">
        <span className="font-semibold text-foreground tabular-nums">
          {outstanding > 0 ? formatCurrency(outstanding) : '—'}
        </span>
        <span className="text-xs text-muted-foreground">
          {caseItem.documents.length} file{caseItem.documents.length !== 1 ? 's' : ''} · {formatDate(caseItem.createdAt)}
        </span>
      </div>
    </button>
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
  // They'd otherwise clutter the dashboard with empty rows.
  const cases = allCases.filter((c) => c.status !== 'DRAFT');

  const activeCount = cases.filter(
    (c) => !['RESOLVED', 'CLOSED'].includes(c.status)
  ).length;

  const pendingActionCount = cases.filter((c) =>
    ['STRATEGY_PENDING', 'ASSEMBLING'].includes(c.status)
  ).length;

  const resolvedCount = cases.filter((c) =>
    ['RESOLVED', 'CLOSED'].includes(c.status)
  ).length;

  const totalOutstanding = cases.reduce((sum, c) => {
    const owed = parseFloat(c.amountOwed || '0');
    const paid = parseFloat(c.amountPaid || '0');
    return sum + Math.max(0, owed - paid);
  }, 0);

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
          <p className="text-muted-foreground text-sm mt-1">
            Manage your business collections matters
          </p>
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

      {/* Cases */}
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
          {/* Desktop table */}
          <div className="card overflow-hidden hidden sm:block">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Case</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Outstanding</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Documents</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Created</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {cases.map((c) => (
                  <CaseRow key={c.id} caseItem={c} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="grid grid-cols-1 gap-3 sm:hidden">
            {cases.map((c) => (
              <CaseCard key={c.id} caseItem={c} />
            ))}
          </div>
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
