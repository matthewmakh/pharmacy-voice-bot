import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { generateAffidavitOfService } from '../../../lib/api';
import type { Case } from '../../../types';
import SectionCard from '../../../components/ui/SectionCard';
import { RotatingFact } from '../shared/RotatingFact';
import DocumentActions from './DocumentActions';

export default function AffidavitPanel({ caseData }: { caseData: Case }) {
  const queryClient = useQueryClient();
  const startedRef = React.useRef<Date | null>(null);

  const mutation = useMutation({
    mutationFn: () => { startedRef.current = new Date(); return generateAffidavitOfService(caseData.id); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });

  const svcAction = caseData.actions.find(a => a.type === 'SERVICE_INITIATED');
  if (!svcAction) return null;

  return (
    <SectionCard
      title={<div className="flex items-center gap-2"><FileText className="w-4 h-4 text-emerald-600" />Affidavit of Service</div>}
      description="Service has been initiated. Generate an Affidavit of Service template for your process server to complete and sign after serving the defendant."
      collapsible
      defaultOpen={!!caseData.affidavitOfServiceHtml}
    >
      {mutation.isPending ? (
        <RotatingFact label="Generating affidavit of service…" startedAt={startedRef.current ?? undefined} estimatedSeconds={15} />
      ) : caseData.affidavitOfServiceHtml ? (
        <div className="space-y-4">
          <DocumentActions
            caseId={caseData.id}
            html={caseData.affidavitOfServiceHtml}
            downloadName="affidavit-of-service"
            viewTitle="Affidavit of Service"
            filename="affidavit-of-service.pdf"
            onRegenerate={() => mutation.mutate()}
          />
          <div className="card p-8">
            <div className="prose prose-sm max-w-none prose-slate" dangerouslySetInnerHTML={{ __html: caseData.affidavitOfServiceHtml }} />
          </div>
        </div>
      ) : (
        <div className="text-center py-4">
          <p className="text-sm text-slate-500 mb-4">
            Generate a pre-filled Affidavit of Service template. Your process server completes and signs this after service.
          </p>
          <button onClick={() => mutation.mutate()} className="btn-primary">Generate Affidavit of Service</button>
        </div>
      )}
    </SectionCard>
  );
}
