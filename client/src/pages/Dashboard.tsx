import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, ArrowRight, AlertCircle, TrendingUp, Clock, CheckCircle2 } from 'lucide-react';
import { getCases } from '../lib/api';
import { formatCurrency, formatDate } from '../lib/utils';
import StatusPill from '../components/ui/StatusPill';
import EmptyState from '../components/ui/EmptyState';
import Alert from '../components/ui/Alert';
import type { CaseListItem } from '../types';

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: React.ElementType; color: string }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-slate-500 font-medium">{label}</div>
          <div className="text-3xl font-bold text-slate-900 mt-1">{value}</div>
        </div>
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${color}`}>
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
      className="hover:bg-slate-50 cursor-pointer transition-colors"
      onClick={() => navigate(`/cases/${caseItem.id}`)}
    >
      <td className="px-6 py-4">
        <div className="font-medium text-slate-900 text-sm">
          {caseItem.title || 'Untitled Case'}
        </div>
        <div className="text-xs text-slate-500 mt-0.5">
          {caseItem.debtorBusiness || caseItem.debtorName || '—'}
        </div>
      </td>
      <td className="px-6 py-4">
        <StatusPill status={caseItem.status} />
      </td>
      <td className="px-6 py-4 text-sm text-slate-700 font-medium">
        {outstanding > 0 ? formatCurrency(outstanding) : '—'}
      </td>
      <td className="px-6 py-4 text-sm text-slate-500">
        {caseItem.documents.length} file{caseItem.documents.length !== 1 ? 's' : ''}
      </td>
      <td className="px-6 py-4 text-sm text-slate-500">
        {formatDate(caseItem.createdAt)}
      </td>
      <td className="px-6 py-4">
        <ArrowRight className="w-4 h-4 text-slate-400" />
      </td>
    </tr>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { data: cases = [], isLoading, error } = useQuery({
    queryKey: ['cases'],
    queryFn: getCases,
    refetchInterval: 10000,
  });

  const activeCount = cases.filter(
    (c) => !['RESOLVED', 'CLOSED'].includes(c.status)
  ).length;

  const pendingActionCount = cases.filter((c) =>
    ['STRATEGY_PENDING', 'ASSEMBLING', 'DRAFT'].includes(c.status)
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
        <div className="text-slate-500">Loading cases...</div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Cases</h1>
          <p className="text-slate-500 text-sm mt-1">
            Manage your business collections matters
          </p>
        </div>
        <button onClick={() => navigate('/cases/new')} className="btn-primary btn-lg">
          <Plus className="w-4 h-4" />
          New Case
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Active Cases"
          value={activeCount}
          icon={TrendingUp}
          color="bg-blue-100 text-blue-600"
        />
        <StatCard
          label="Needs Attention"
          value={pendingActionCount}
          icon={AlertCircle}
          color="bg-amber-100 text-amber-600"
        />
        <StatCard
          label="Total Outstanding"
          value={formatCurrency(totalOutstanding)}
          icon={Clock}
          color="bg-red-100 text-red-500"
        />
        <StatCard
          label="Resolved"
          value={resolvedCount}
          icon={CheckCircle2}
          color="bg-green-100 text-green-600"
        />
      </div>

      {error && (
        <div className="mb-6">
          <Alert tone="danger">Failed to load cases. Please refresh.</Alert>
        </div>
      )}

      {/* Cases table */}
      {cases.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<TrendingUp className="w-6 h-6" />}
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
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Case
                </th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Outstanding
                </th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Documents
                </th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Created
                </th>
                <th className="px-6 py-3.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cases.map((c) => (
                <CaseRow key={c.id} caseItem={c} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
