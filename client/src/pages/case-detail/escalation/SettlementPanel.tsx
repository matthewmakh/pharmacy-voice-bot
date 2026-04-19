import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Eye, FileText } from 'lucide-react';
import { generateSettlement, generatePaymentPlan, getPdfDownloadUrl } from '../../../lib/api';
import type { Case } from '../../../types';
import SectionCard from '../../../components/ui/SectionCard';
import { InlineProgress } from '../shared/InlineProgress';
import { VerificationPanel } from '../shared/VerificationPanel';
import { openHtmlInTab } from '../shared/openHtmlInTab';

export default function SettlementPanel({ caseData }: { caseData: Case }) {
  const queryClient = useQueryClient();
  const settlementRef = React.useRef<Date | null>(null);
  const paymentPlanRef = React.useRef<Date | null>(null);

  const settlementMutation = useMutation({
    mutationFn: () => { settlementRef.current = new Date(); return generateSettlement(caseData.id); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });
  const paymentPlanMutation = useMutation({
    mutationFn: () => { paymentPlanRef.current = new Date(); return generatePaymentPlan(caseData.id); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });

  return (
    <SectionCard
      title={<div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" />Settlement Track</div>}
      description="Many cases settle after a demand letter or final notice. If the debtor contacts you, put any agreement in writing immediately."
      collapsible
      defaultOpen={!!(caseData.settlementHtml || caseData.paymentPlanHtml)}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Stipulation of Settlement */}
        <div className="p-4 rounded-xl border border-slate-200 bg-white">
          <div className="text-sm font-semibold text-slate-800 mb-1">Stipulation of Settlement</div>
          <p className="text-xs text-slate-500 mb-3 leading-relaxed">
            A binding agreement between both parties — settlement amount, payment terms, mutual release, default provisions.
          </p>
          {settlementMutation.isPending && settlementRef.current ? (
            <InlineProgress startedAt={settlementRef.current} estimatedSeconds={15} label="Generating…" />
          ) : caseData.settlementHtml ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => openHtmlInTab(caseData.settlementHtml!, 'Stipulation of Settlement')} className="btn-secondary text-xs">
                  <Eye className="w-3.5 h-3.5" /> View
                </button>
                <a href={getPdfDownloadUrl(caseData.id, 'settlement')} download="stipulation-of-settlement.pdf" className="btn-primary text-xs">
                  <FileText className="w-3.5 h-3.5" /> Download PDF
                </a>
                <button onClick={() => settlementMutation.mutate()} className="btn-ghost text-xs">Regenerate</button>
              </div>
              {caseData.settlementVerification && <VerificationPanel verification={caseData.settlementVerification} />}
            </div>
          ) : (
            <button onClick={() => settlementMutation.mutate()} className="btn-secondary text-sm">Generate Settlement Agreement</button>
          )}
        </div>

        {/* Payment Plan */}
        <div className="p-4 rounded-xl border border-slate-200 bg-white">
          <div className="text-sm font-semibold text-slate-800 mb-1">Payment Plan Agreement</div>
          <p className="text-xs text-slate-500 mb-3 leading-relaxed">
            Standalone installment agreement with acknowledgment of debt, acceleration clause, and interest on missed payments.
          </p>
          {paymentPlanMutation.isPending && paymentPlanRef.current ? (
            <InlineProgress startedAt={paymentPlanRef.current} estimatedSeconds={15} label="Generating…" />
          ) : caseData.paymentPlanHtml ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => openHtmlInTab(caseData.paymentPlanHtml!, 'Payment Plan Agreement')} className="btn-secondary text-xs">
                  <Eye className="w-3.5 h-3.5" /> View
                </button>
                <a href={getPdfDownloadUrl(caseData.id, 'payment-plan')} download="payment-plan-agreement.pdf" className="btn-primary text-xs">
                  <FileText className="w-3.5 h-3.5" /> Download PDF
                </a>
                <button onClick={() => paymentPlanMutation.mutate()} className="btn-ghost text-xs">Regenerate</button>
              </div>
              {caseData.paymentPlanVerification && <VerificationPanel verification={caseData.paymentPlanVerification} />}
            </div>
          ) : (
            <button onClick={() => paymentPlanMutation.mutate()} className="btn-secondary text-sm">Generate Payment Plan</button>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
