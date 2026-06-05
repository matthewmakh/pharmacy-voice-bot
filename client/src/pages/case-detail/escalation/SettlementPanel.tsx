import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Eye, PenTool, Loader2, Check } from 'lucide-react';
import { generateSettlement, generatePaymentPlan, sendForSignature } from '../../../lib/api';
import type { Case } from '../../../types';
import SectionCard from '../../../components/ui/SectionCard';
import { InlineProgress } from '../shared/InlineProgress';
import { VerificationPanel } from '../shared/VerificationPanel';
import { PdfDownloadButton } from '../shared/PdfDownloadButton';
import { openHtmlInTab } from '../shared/openHtmlInTab';

export default function SettlementPanel({ caseData, defaultOpen }: { caseData: Case; defaultOpen?: boolean }) {
  const queryClient = useQueryClient();
  const settlementRef = React.useRef<Date | null>(null);
  const paymentPlanRef = React.useRef<Date | null>(null);
  const [signError, setSignError] = React.useState<string | null>(null);

  const settlementMutation = useMutation({
    mutationFn: () => { settlementRef.current = new Date(); return generateSettlement(caseData.id); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });
  const paymentPlanMutation = useMutation({
    mutationFn: () => { paymentPlanRef.current = new Date(); return generatePaymentPlan(caseData.id); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });

  const sendSettlementMutation = useMutation({
    mutationFn: () => sendForSignature(caseData.id, 'settlement'),
    onSuccess: () => {
      setSignError(null);
      queryClient.invalidateQueries({ queryKey: ['case', caseData.id] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        || (err as Error)?.message
        || 'Failed to send for signature';
      setSignError(msg);
    },
  });
  const sendPaymentPlanMutation = useMutation({
    mutationFn: () => sendForSignature(caseData.id, 'payment-plan'),
    onSuccess: () => {
      setSignError(null);
      queryClient.invalidateQueries({ queryKey: ['case', caseData.id] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        || (err as Error)?.message
        || 'Failed to send for signature';
      setSignError(msg);
    },
  });

  return (
    <SectionCard
      title={<div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" />Settlement Track</div>}
      description="Many cases settle after a demand letter or final notice. If the debtor contacts you, put any agreement in writing immediately."
      collapsible
      defaultOpen={defaultOpen ?? !!(caseData.settlementHtml || caseData.paymentPlanHtml)}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Stipulation of Settlement */}
        <div className="p-4 rounded-xl border border-border bg-card">
          <div className="text-sm font-semibold text-foreground mb-1">Stipulation of Settlement</div>
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
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
                <PdfDownloadButton caseId={caseData.id} type="settlement" filename="stipulation-of-settlement.pdf" size="xs" />
                <button onClick={() => settlementMutation.mutate()} className="btn-ghost text-xs">Regenerate</button>
              </div>
              <SignatureRow
                kind="settlement"
                signedAt={caseData.settlementSignedAt}
                requestId={caseData.settlementSignatureRequestId}
                isPending={sendSettlementMutation.isPending}
                onSend={() => sendSettlementMutation.mutate()}
                disabled={!caseData.claimantEmail || !caseData.debtorEmail}
              />
              {caseData.settlementVerification && <VerificationPanel verification={caseData.settlementVerification} />}
            </div>
          ) : (
            <button onClick={() => settlementMutation.mutate()} className="btn-secondary text-sm">Generate Settlement Agreement</button>
          )}
        </div>

        {/* Payment Plan */}
        <div className="p-4 rounded-xl border border-border bg-card">
          <div className="text-sm font-semibold text-foreground mb-1">Payment Plan Agreement</div>
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
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
                <PdfDownloadButton caseId={caseData.id} type="payment-plan" filename="payment-plan-agreement.pdf" size="xs" />
                <button onClick={() => paymentPlanMutation.mutate()} className="btn-ghost text-xs">Regenerate</button>
              </div>
              <SignatureRow
                kind="payment-plan"
                signedAt={caseData.paymentPlanSignedAt}
                requestId={caseData.paymentPlanSignatureRequestId}
                isPending={sendPaymentPlanMutation.isPending}
                onSend={() => sendPaymentPlanMutation.mutate()}
                disabled={!caseData.claimantEmail || !caseData.debtorEmail}
              />
              {caseData.paymentPlanVerification && <VerificationPanel verification={caseData.paymentPlanVerification} />}
            </div>
          ) : (
            <button onClick={() => paymentPlanMutation.mutate()} className="btn-secondary text-sm">Generate Payment Plan</button>
          )}
        </div>
      </div>

      {signError && (
        <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{signError}</div>
      )}
    </SectionCard>
  );
}

function SignatureRow({
  kind,
  signedAt,
  requestId,
  isPending,
  onSend,
  disabled,
}: {
  kind: 'settlement' | 'payment-plan';
  signedAt: string | null;
  requestId: string | null;
  isPending: boolean;
  onSend: () => void;
  disabled: boolean;
}) {
  if (signedAt) {
    return (
      <div className="flex items-center gap-2 text-xs text-emerald-700">
        <Check className="w-3.5 h-3.5" />
        <span>Fully signed {new Date(signedAt).toLocaleDateString()}</span>
      </div>
    );
  }
  if (requestId) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <PenTool className="w-3.5 h-3.5" />
        <span>Out for signature — awaiting parties</span>
      </div>
    );
  }
  return (
    <button
      onClick={onSend}
      disabled={disabled || isPending}
      className="btn-secondary text-xs"
      title={disabled ? 'Both claimant and debtor email required' : `Send ${kind} for e-signature`}
    >
      {isPending ? (
        <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending…</>
      ) : (
        <><PenTool className="w-3.5 h-3.5" /> Send for E-Signature</>
      )}
    </button>
  );
}
