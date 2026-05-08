import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Copy, Mail, Eye, Send } from 'lucide-react';
import {
  generateLetter,
  logAction,
  getPdfDownloadUrl,
} from '../../lib/api';
import type { Case } from '../../types';
import SectionCard from '../../components/ui/SectionCard';
import EmptyState from '../../components/ui/EmptyState';
import { RotatingFact } from './shared/RotatingFact';
import { VerificationPanel } from './shared/VerificationPanel';
import { openHtmlInTab } from './shared/openHtmlInTab';
import SendDemandPanel from './SendDemandPanel';
import DebtorPortalCard from './DebtorPortalCard';
import PayoutStatusCard from './PayoutStatusCard';

export default function LetterTab({ caseData }: { caseData: Case }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const generateStartRef = React.useRef<Date | null>(null);

  const generateMutation = useMutation({
    mutationFn: () => { generateStartRef.current = new Date(); return generateLetter(caseData.id); },
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
    } catch { /* non-blocking */ }
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
      <PayoutStatusCard caseData={caseData} />
      <SendDemandPanel caseData={caseData} />
      <DebtorPortalCard caseData={caseData} />

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
            <span className="text-xs text-slate-400">No debtor email on file — add one in Overview to enable email.</span>
          )}
          <button
            onClick={() => openHtmlInTab(caseData.demandLetterHtml || '', 'Demand Letter')}
            className="btn-secondary text-sm"
          >
            <Eye className="w-4 h-4" /> View
          </button>
          <a
            href={getPdfDownloadUrl(caseData.id, 'demand-letter')}
            download="demand-letter.pdf"
            className="btn-primary text-sm"
          >
            <FileText className="w-4 h-4" /> Download PDF
          </a>
          <button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            className="btn-ghost text-sm ml-auto"
          >
            Regenerate
          </button>
        </div>
      </SectionCard>

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
