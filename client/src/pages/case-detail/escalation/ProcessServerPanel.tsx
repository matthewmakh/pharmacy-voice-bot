import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Send, CheckCircle2, X } from 'lucide-react';
import { logAction } from '../../../lib/api';
import type { Case } from '../../../types';
import SectionCard from '../../../components/ui/SectionCard';
import Alert from '../../../components/ui/Alert';
import Badge, { type Tone } from '../../../components/ui/Badge';

export default function ProcessServerPanel({ caseData }: { caseData: Case }) {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [notes, setNotes] = useState('');

  const mutation = useMutation({
    mutationFn: () => logAction(
      caseData.id,
      'SERVICE_INITIATED',
      notes || `Process server engagement initiated. Defendant address: ${caseData.debtorAddress || '[unknown]'}`,
      { debtorAddress: caseData.debtorAddress, notes }
    ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['case', caseData.id] });
      setShowModal(false);
      setNotes('');
    },
  });

  const svcAction = caseData.actions.find(a => a.type === 'SERVICE_INITIATED');
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <>
      <SectionCard
        title={<div className="flex items-center gap-2"><Send className="w-4 h-4 text-blue-500" />Process Server Engagement</div>}
        description="For Civil Court and Supreme Court cases, a licensed process server must serve the summons. Log when service is initiated."
        collapsible
        defaultOpen={!svcAction}
      >
        <div className="grid grid-cols-2 gap-4 text-sm mb-4">
          <div>
            <div className="field-label mb-0.5">Defendant</div>
            <div className="field-value">{caseData.debtorBusiness || caseData.debtorName || '[unknown]'}</div>
          </div>
          <div>
            <div className="field-label mb-0.5">Address</div>
            <div className="field-value">{caseData.debtorAddress || '[unknown — required for service]'}</div>
          </div>
        </div>

        {!svcAction ? (
          <button onClick={() => setShowModal(true)} className="btn-secondary text-sm">
            Log Service Initiated
          </button>
        ) : (() => {
          const svcDate = new Date(svcAction.createdAt);
          const personalDeadline = new Date(svcDate); personalDeadline.setDate(personalDeadline.getDate() + 20);
          const altDeadline = new Date(svcDate); altDeadline.setDate(altDeadline.getDate() + 30);
          const defaultDate = new Date(altDeadline); defaultDate.setDate(defaultDate.getDate() + 1);
          const today = new Date();
          const personalDaysLeft = Math.ceil((personalDeadline.getTime() - today.getTime()) / 86400000);
          const altDaysLeft = Math.ceil((altDeadline.getTime() - today.getTime()) / 86400000);

          const deadlines = [
            { label: 'Answer deadline (personal service)', date: personalDeadline, days: personalDaysLeft, note: 'CPLR: 20 days' },
            { label: 'Answer deadline (other service)', date: altDeadline, days: altDaysLeft, note: 'CPLR: 30 days' },
            { label: 'Default motion date', date: defaultDate, days: altDaysLeft + 1, note: 'Day after answer deadline' },
          ];

          return (
            <div className="space-y-3">
              <Alert tone="success" icon={<CheckCircle2 className="w-4 h-4" />}>
                Service initiated {fmt(svcDate)} — deadlines calculated below.
              </Alert>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {deadlines.map(({ label, date, days, note }) => {
                  const isPast = days < 0;
                  const isUrgent = days >= 0 && days <= 7;
                  const tone: Tone = isPast ? 'danger' : isUrgent ? 'warning' : 'neutral';
                  return (
                    <div key={label} className={`p-3 rounded-lg border ${isPast ? 'border-red-200 bg-red-50' : isUrgent ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
                      <div className="text-xs text-slate-500 leading-tight mb-1">{label}</div>
                      <div className={`text-sm font-semibold ${isPast ? 'text-red-700' : isUrgent ? 'text-amber-700' : 'text-slate-700'}`}>
                        {fmt(date)}
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <div className="text-xs text-slate-400">{note}</div>
                        {isPast && <Badge tone={tone} size="sm">Passed</Badge>}
                        {isUrgent && !isPast && <Badge tone={tone} size="sm">{days}d left</Badge>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Calendar these immediately. If the defendant does not appear or answer by the applicable deadline, you may move for default judgment.
              </p>
            </div>
          );
        })()}
      </SectionCard>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-slate-900">Log Service Initiated</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 rounded-lg text-sm">
                <div className="field-label mb-0.5">Serving</div>
                <div className="font-semibold text-slate-800">{caseData.debtorBusiness || caseData.debtorName || '[unknown defendant]'}</div>
                <div className="text-slate-600 mt-1">{caseData.debtorAddress || '[address unknown]'}</div>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Process server name, instructions, date engaged…"
                  className="input h-24 resize-none"
                />
              </div>
              <Alert tone="info">
                This logs a <code>SERVICE_INITIATED</code> action in the case timeline. The process server is responsible for completing service and providing an Affidavit of Service.
              </Alert>
              <div className="flex justify-end gap-3">
                <button onClick={() => setShowModal(false)} className="btn-secondary text-sm">Cancel</button>
                <button
                  onClick={() => mutation.mutate()}
                  disabled={mutation.isPending}
                  className="btn-primary text-sm"
                >
                  {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirm — Log Service
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
