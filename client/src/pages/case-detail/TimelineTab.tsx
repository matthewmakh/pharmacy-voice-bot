import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Clock } from 'lucide-react';
import { logAction } from '../../lib/api';
import { formatDate } from '../../lib/utils';
import type { Case, ActionType } from '../../types';
import SectionCard from '../../components/ui/SectionCard';
import EmptyState from '../../components/ui/EmptyState';
import { ACTION_TYPE_OPTIONS, ACTION_ICONS } from './shared/actions';

export default function TimelineTab({ caseData }: { caseData: Case }) {
  const queryClient = useQueryClient();
  const [actionType, setActionType] = useState<ActionType>('EMAIL_SENT');
  const [actionNotes, setActionNotes] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');

  const logMutation = useMutation({
    mutationFn: () => logAction(
      caseData.id,
      actionType,
      actionNotes || undefined,
      actionType === 'PAYMENT_RECEIVED' && paymentAmount ? { amount: parseFloat(paymentAmount) } : undefined
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case', caseData.id] });
      setActionNotes('');
      setPaymentAmount('');
    },
  });

  const sortedActions = [...caseData.actions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <div className="space-y-6">
      <SectionCard title="Log an Action">
        <div className="flex gap-3 items-end flex-wrap">
          <div className="flex-1 min-w-[160px]">
            <label className="label">Action Type</label>
            <select
              value={actionType}
              onChange={(e) => setActionType(e.target.value as ActionType)}
              className="input"
            >
              {ACTION_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="flex-[2] min-w-[200px]">
            <label className="label">Notes</label>
            <textarea
              value={actionNotes}
              onChange={(e) => setActionNotes(e.target.value)}
              className="input"
              rows={2}
              placeholder="Optional notes…"
            />
          </div>
          {actionType === 'PAYMENT_RECEIVED' && (
            <div className="w-48 shrink-0">
              <label className="label">Amount Received ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                className="input"
                placeholder="0.00"
              />
            </div>
          )}
          <button
            onClick={() => logMutation.mutate()}
            disabled={logMutation.isPending}
            className="btn-primary whitespace-nowrap"
          >
            {logMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Log Action
          </button>
        </div>
      </SectionCard>

      {sortedActions.length > 0 ? (
        <div className="card divide-y divide-slate-100">
          {sortedActions.map((action) => {
            const Icon = ACTION_ICONS[action.type] ?? Clock;
            return (
              <div key={action.id} className="flex items-start gap-4 p-4">
                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-slate-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800">
                    {action.label || action.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </div>
                  {action.notes && <p className="text-sm text-slate-500 mt-0.5">{action.notes}</p>}
                </div>
                <div className="text-xs text-slate-400 whitespace-nowrap shrink-0">
                  {formatDate(action.createdAt)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <EmptyState
            icon={<Clock className="w-6 h-6" />}
            title="No actions logged yet"
            description="Actions will appear here as your case progresses."
          />
        </div>
      )}
    </div>
  );
}
