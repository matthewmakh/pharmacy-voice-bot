import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Copy, Mail, Eye, Send, Loader2 } from 'lucide-react';
import { generateLetter, logAction } from '../../lib/api';
import type { Case } from '../../types';
import SectionCard from '../../components/ui/SectionCard';
import EmptyState from '../../components/ui/EmptyState';
import Alert from '../../components/ui/Alert';
import { RotatingFact } from './shared/RotatingFact';
import { VerificationPanel } from './shared/VerificationPanel';
import { PdfDownloadButton } from './shared/PdfDownloadButton';
import { openHtmlInTab } from './shared/openHtmlInTab';

export default function LetterTab({ caseData }: { caseData: Case }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const generateStartRef = React.useRef<Date | null>(null);

  const generateMutation = useMutation({
    mutationFn: () => { generateStartRef.current = new Date(); return generateLetter(caseData.id); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });

  // The letter has to be *sent* before escalation unlocks. Sent = status moved past READY,
  // or a send action was logged (email here, or "Mark as Sent" for mail/other channels).
  const sent =
    ['SENT', 'AWAITING_RESPONSE', 'ESCALATING', 'RESOLVED', 'CLOSED'].includes(caseData.status) ||
    caseData.actions.some((a) => a.type === 'EMAIL_SENT' || a.type === 'CERTIFIED_MAIL_SENT' || a.type === 'FINAL_NOTICE_SENT');
  const markSentMutation = useMutation({
    mutationFn: () => logAction(caseData.id, 'CERTIFIED_MAIL_SENT', 'Demand letter marked as sent'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });

  const isGenerating = caseData.status === 'GENERATING' || generateMutation.isPending;
  const generateStartedAt: Date | undefined = isGenerating
    ? caseData.status === 'GENERATING' ? new Date(caseData.updatedAt) : (generateStartRef.current ?? undefined)
    : undefined;

  const handleCopy = () => {
    if (caseData.demandLetter) {
      navigator.clipboard.writeText(caseData.demandLetter);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleEmail = async () => {
    if (!caseData.debtorEmail) return;
    const subject = encodeURIComponent(`Demand for Payment — ${caseData.debtorBusiness || caseData.debtorName || 'Outstanding Balance'}`);
    const body = encodeURIComponent(caseData.demandLetter || '');
    window.open(`mailto:${caseData.debtorEmail}?subject=${subject}&body=${body}`);
    try {
      await logAction(caseData.id, 'EMAIL_SENT', `Demand letter emailed to ${caseData.debtorEmail}`);
      queryClient.invalidateQueries({ queryKey: ['case', caseData.id] });
    } catch (err) {
      // The mail client opened regardless; just note the timeline log didn't persist.
      console.error('Failed to log EMAIL_SENT action:', err);
    }
  };

  if (!caseData.demandLetterHtml && !isGenerating) {
    return (
      <div className="card">
        <EmptyState
          icon={<FileText className="w-6 h-6" />}
          title="Generate Demand Letter"
          description={caseData.strategy
            ? 'Generate a professional demand letter based on your case details and selected strategy.'
            : 'Select a strategy first, then generate your demand letter.'}
          action={
            <button
              onClick={() => generateMutation.mutate()}
              disabled={!caseData.strategy || generateMutation.isPending}
              className="btn-primary"
            >
              <Send className="w-4 h-4" /> Generate Letter
            </button>
          }
        />
      </div>
    );
  }

  if (isGenerating) {
    return <RotatingFact label="Generating demand letter…" startedAt={generateStartedAt} estimatedSeconds={25} />;
  }

  return (
    <div className="space-y-4">
      <SectionCard title="Demand Letter" padding="sm">
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={handleCopy} className="btn-secondary text-sm">
            <Copy className="w-4 h-4" /> {copied ? 'Copied!' : 'Copy Text'}
          </button>
          {caseData.debtorEmail ? (
            <button onClick={handleEmail} className="btn-secondary text-sm">
              <Mail className="w-4 h-4" /> Email to Debtor
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">No debtor email on file — add one in Overview to enable email.</span>
          )}
          <button
            onClick={() => openHtmlInTab(caseData.demandLetterHtml || '', 'Demand Letter')}
            className="btn-secondary text-sm"
          >
            <Eye className="w-4 h-4" /> View
          </button>
          <PdfDownloadButton caseId={caseData.id} type="demand-letter" filename="demand-letter.pdf" />
          <button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            className="btn-ghost text-sm ml-auto"
          >
            Regenerate
          </button>
        </div>
      </SectionCard>

      {sent ? (
        <Alert tone="success">
          Marked as sent — the <strong>Escalation</strong> stage is unlocked. Use the stage rail or the “Do this next” prompt above to continue.
        </Alert>
      ) : (
        <Alert tone="info" title="Next step — send it to continue">
          Send this letter to the debtor; the <strong>Escalation</strong> stage (court forms, default judgment) unlocks once it’s sent. Use <strong>Email to Debtor</strong> above, or mark it sent if you delivered it another way.
          <div className="mt-2.5">
            <button onClick={() => markSentMutation.mutate()} disabled={markSentMutation.isPending} className="btn-primary btn-sm">
              {markSentMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Mark as Sent
            </button>
          </div>
        </Alert>
      )}

      {caseData.demandLetterVerification && (
        <VerificationPanel verification={caseData.demandLetterVerification} />
      )}

      <div className="card p-8">
        <div
          className="prose prose-sm max-w-none prose-slate"
          dangerouslySetInnerHTML={{ __html: caseData.demandLetterHtml || '' }}
        />
      </div>
    </div>
  );
}
