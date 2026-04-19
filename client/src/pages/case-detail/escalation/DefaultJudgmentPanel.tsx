import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Scale } from 'lucide-react';
import { generateDefaultJudgment } from '../../../lib/api';
import type { Case } from '../../../types';
import SectionCard from '../../../components/ui/SectionCard';
import Alert from '../../../components/ui/Alert';
import { RotatingFact } from '../shared/RotatingFact';
import { VerificationPanel } from '../shared/VerificationPanel';
import DocumentActions from './DocumentActions';

export default function DefaultJudgmentPanel({ caseData }: { caseData: Case }) {
  const queryClient = useQueryClient();
  const startedRef = React.useRef<Date | null>(null);

  const mutation = useMutation({
    mutationFn: () => { startedRef.current = new Date(); return generateDefaultJudgment(caseData.id); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });

  const svcAction = caseData.actions.find(a => a.type === 'SERVICE_INITIATED');
  const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <SectionCard
      title={<div className="flex items-center gap-2"><Scale className="w-4 h-4 text-slate-500" />Default Judgment Motion</div>}
      collapsible
      defaultOpen={!!caseData.defaultJudgmentHtml}
    >
      {!svcAction ? (
        <Alert tone="neutral">
          Log service initiation in the <strong>Process Server Engagement</strong> section above first. Once service is logged, return here after the answer deadline has passed if the defendant does not respond.
        </Alert>
      ) : (() => {
        const svcDate = new Date(svcAction.createdAt);
        const altDeadline = new Date(svcDate); altDeadline.setDate(altDeadline.getDate() + 30);
        const today = new Date();
        const canFileDefault = today > altDeadline;
        const daysUntil = Math.ceil((altDeadline.getTime() - today.getTime()) / 86400000);

        if (!canFileDefault) {
          return (
            <Alert tone="warning">
              The answer deadline has not yet passed. The defendant has until <strong>{fmtDate(altDeadline)}</strong> ({daysUntil} {daysUntil === 1 ? 'day' : 'days'} from now) to respond. Return here after that date if no answer is filed.
            </Alert>
          );
        }

        return (
          <>
            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              The answer deadline has passed. If the defendant has not appeared or answered, you can move for a default judgment. Service was initiated on {fmtDate(svcDate)}; the 30-day answer deadline was {fmtDate(altDeadline)}.
            </p>
            {mutation.isPending ? (
              <RotatingFact label="Generating default judgment motion…" startedAt={startedRef.current ?? undefined} estimatedSeconds={30} />
            ) : caseData.defaultJudgmentHtml ? (
              <div className="space-y-4">
                <DocumentActions
                  caseId={caseData.id}
                  html={caseData.defaultJudgmentHtml}
                  downloadName="default-judgment"
                  viewTitle="Default Judgment Motion"
                  filename="default-judgment-motion.pdf"
                  onRegenerate={() => mutation.mutate()}
                />
                {caseData.defaultJudgmentVerification && (
                  <VerificationPanel verification={caseData.defaultJudgmentVerification} />
                )}
                <div className="card p-8">
                  <div className="prose prose-sm max-w-none prose-slate" dangerouslySetInnerHTML={{ __html: caseData.defaultJudgmentHtml }} />
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-sm text-slate-500 mb-4">
                  Generate a Motion for Default Judgment package — Notice of Motion, Affidavit in Support, Proposed Order, and blank Affidavit of Service template.
                </p>
                <button onClick={() => mutation.mutate()} className="btn-primary">
                  Generate Default Judgment Motion
                </button>
              </div>
            )}
          </>
        );
      })()}
    </SectionCard>
  );
}
