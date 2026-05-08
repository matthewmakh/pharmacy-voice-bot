import React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Scale, ArrowRight } from 'lucide-react';
import { generateCourtForm } from '../../../lib/api';
import { formatCurrency } from '../../../lib/utils';
import type { Case } from '../../../types';
import SectionCard from '../../../components/ui/SectionCard';
import Alert from '../../../components/ui/Alert';
import { RotatingFact } from '../shared/RotatingFact';
import { VerificationPanel } from '../shared/VerificationPanel';
import DocumentActions from './DocumentActions';

export default function CourtFormPanel({ caseData }: { caseData: Case }) {
  const queryClient = useQueryClient();
  const startedRef = React.useRef<Date | null>(null);

  const mutation = useMutation({
    mutationFn: () => { startedRef.current = new Date(); return generateCourtForm(caseData.id); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });

  const outstanding = parseFloat(caseData.amountOwed || '0') - parseFloat(caseData.amountPaid || '0');
  const courtTrack = outstanding <= 10000 ? 'commercial' : outstanding <= 50000 ? 'civil' : 'supreme';
  const courtFormName = courtTrack === 'commercial'
    ? 'Commercial Claims Court — CIV-SC-70'
    : courtTrack === 'civil'
    ? 'NYC Civil Court — Pro Se Summons & Complaint'
    : 'Supreme Court — Summons with Notice';

  return (
    <SectionCard
      title={<div className="flex items-center gap-2"><Scale className="w-4 h-4 text-blue-600" />Court Form — {caseData.courtFormType || courtFormName}</div>}
      description={<>
        Based on your outstanding balance of <strong>{formatCurrency(outstanding)}</strong>, the applicable form is <strong>{courtFormName}</strong>.
      </>}
      collapsible
      defaultOpen={!!caseData.filingPacketHtml}
    >
      <Alert tone="warning" title="Review every field carefully before filing">
        This form will be pre-filled with your case data. Look for <code>[UNKNOWN — VERIFY BEFORE FILING]</code> placeholders where data is missing.
      </Alert>

      {mutation.isPending ? (
        <div className="mt-4">
          <RotatingFact
            label="Generating court form…"
            sublabel="Generate → verify → correct pipeline"
            startedAt={startedRef.current ?? undefined}
            estimatedSeconds={70}
          />
        </div>
      ) : caseData.filingPacketHtml ? (
        <div className="space-y-4 mt-4">
          <DocumentActions
            caseId={caseData.id}
            html={caseData.filingPacketHtml}
            downloadName="court-form"
            viewTitle={courtFormName}
            filename="court-form.pdf"
            onRegenerate={() => mutation.mutate()}
          />
          {caseData.courtFormVerification && <VerificationPanel verification={caseData.courtFormVerification} />}
          {caseData.courtFormInstructions && caseData.courtFormInstructions.length > 0 && (
            <Alert tone="info" title="Next Steps">
              <ol className="space-y-1.5 mt-1">
                {caseData.courtFormInstructions.map((step, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span className="font-bold opacity-60 shrink-0">{i + 1}.</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </Alert>
          )}
          <Link
            to={`/cases/${caseData.id}/walkthrough?purpose=complaint&type=${
              courtTrack === 'commercial' ? 'commercial-claims' : courtTrack === 'civil' ? 'edds' : 'nyscef'
            }`}
            className="btn-primary"
          >
            Walk me through filing this <ArrowRight className="w-4 h-4" />
          </Link>
          <div className="card p-8">
            <div className="prose prose-sm max-w-none prose-slate" dangerouslySetInnerHTML={{ __html: caseData.filingPacketHtml }} />
          </div>
        </div>
      ) : (
        <div className="text-center py-4 mt-4">
          <div className="text-sm font-semibold text-slate-700 mb-2">{courtFormName}</div>
          <p className="text-sm text-slate-500 mb-4">
            Generate a pre-filled, print-ready version of the correct NYC court form for your case.
          </p>
          <button onClick={() => mutation.mutate()} className="btn-primary">
            Generate Pre-Filled Court Form
          </button>
        </div>
      )}
    </SectionCard>
  );
}
