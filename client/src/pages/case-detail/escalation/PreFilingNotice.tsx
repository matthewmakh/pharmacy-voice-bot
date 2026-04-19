import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Mail, Shield } from 'lucide-react';
import { generateFinalNotice, logAction } from '../../../lib/api';
import type { Case } from '../../../types';
import SectionCard from '../../../components/ui/SectionCard';
import { RotatingFact } from '../shared/RotatingFact';
import DocumentActions from './DocumentActions';

export default function PreFilingNotice({ caseData }: { caseData: Case }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const startedRef = React.useRef<Date | null>(null);

  const mutation = useMutation({
    mutationFn: () => { startedRef.current = new Date(); return generateFinalNotice(caseData.id); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });

  const handleCopy = () => {
    if (caseData.finalNotice) {
      navigator.clipboard.writeText(caseData.finalNotice);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleEmail = async () => {
    if (!caseData.debtorEmail || !caseData.finalNotice) return;
    const subject = encodeURIComponent(`Final Notice — ${caseData.debtorBusiness || caseData.debtorName || 'Outstanding Balance'}`);
    const body = encodeURIComponent(caseData.finalNotice);
    window.open(`mailto:${caseData.debtorEmail}?subject=${subject}&body=${body}`);
    try {
      await logAction(caseData.id, 'EMAIL_SENT', `Final notice emailed to ${caseData.debtorEmail}`);
      queryClient.invalidateQueries({ queryKey: ['case', caseData.id] });
    } catch { /* non-blocking */ }
  };

  return (
    <SectionCard
      title={<div className="flex items-center gap-2"><Shield className="w-4 h-4 text-blue-500" />Pre-Filing Notice</div>}
      description="Send this before filing to give the debtor a final opportunity to pay and to document your escalation path."
      collapsible
      defaultOpen={!!caseData.finalNoticeHtml}
    >
      {mutation.isPending ? (
        <RotatingFact label="Generating pre-filing notice…" startedAt={startedRef.current ?? undefined} estimatedSeconds={20} />
      ) : caseData.finalNoticeHtml ? (
        <div className="space-y-4">
          <DocumentActions
            caseId={caseData.id}
            html={caseData.finalNoticeHtml}
            downloadName="final-notice"
            viewTitle="Pre-Filing Notice"
            filename="final-notice.pdf"
            onRegenerate={() => mutation.mutate()}
            extraActions={
              <>
                <button onClick={handleCopy} className="btn-secondary text-sm">
                  <Copy className="w-4 h-4" /> {copied ? 'Copied!' : 'Copy Text'}
                </button>
                {caseData.debtorEmail ? (
                  <button onClick={handleEmail} className="btn-secondary text-sm">
                    <Mail className="w-4 h-4" /> Email to Debtor
                  </button>
                ) : (
                  <span className="text-xs text-slate-400">No debtor email on file.</span>
                )}
              </>
            }
          />
          <div className="card p-8">
            <div className="prose prose-sm max-w-none prose-slate" dangerouslySetInnerHTML={{ __html: caseData.finalNoticeHtml }} />
          </div>
        </div>
      ) : (
        <div className="text-center py-4">
          <p className="text-sm text-slate-500 mb-4">
            Generate a pre-filing notice — a short, firm letter stating legal action is imminent.
          </p>
          <button onClick={() => mutation.mutate()} className="btn-primary">Generate Pre-Filing Notice</button>
        </div>
      )}
    </SectionCard>
  );
}
