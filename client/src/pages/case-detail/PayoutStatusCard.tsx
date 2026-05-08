import React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DollarSign, Check, Loader2, AlertCircle, ArrowRight } from 'lucide-react';
import { releasePayout } from '../../lib/api';
import type { Case } from '../../types';
import SectionCard from '../../components/ui/SectionCard';

export default function PayoutStatusCard({ caseData }: { caseData: Case }) {
  const queryClient = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);

  const collected = caseData.amountCollectedCents ?? 0;
  if (collected === 0) return null; // hide entirely until a payment is received

  const fee = caseData.reclaimFeeCents ?? Math.floor((collected * 1200) / 10_000);
  const payout = caseData.payoutToClaimantCents ?? collected - fee;
  const released = !!caseData.payoutCompletedAt;

  const mutation = useMutation({
    mutationFn: () => releasePayout(caseData.id),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['case', caseData.id] });
    },
    onError: (err: unknown) => {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error
          || (err as Error)?.message
          || 'Release failed',
      );
    },
  });

  return (
    <SectionCard
      title={
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-emerald-500" />
          Escrow & Payout
        </div>
      }
      description={
        released
          ? 'Funds have been released to your Stripe account.'
          : 'The debtor has paid. Release funds to your Stripe account when you’re ready.'
      }
      defaultOpen
    >
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Stat label="Collected" amount={collected} accent="slate" />
        <Stat label="Reclaim fee (12%)" amount={fee} accent="slate" />
        <Stat label="Payout to you (88%)" amount={payout} accent="emerald" />
      </div>

      {released ? (
        <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-3">
          <Check className="w-4 h-4" />
          <span>
            Released {fmtDateTime(caseData.payoutCompletedAt)}
            {caseData.payoutTransferId && (
              <span className="text-xs text-slate-500 ml-2 font-mono">{caseData.payoutTransferId}</span>
            )}
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          {error && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <span>{error}</span>
                {error.toLowerCase().includes('stripe') && (
                  <Link to="/settings/payouts" className="ml-2 underline">Set up payouts</Link>
                )}
              </div>
            </div>
          )}
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="btn-primary"
          >
            {mutation.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Releasing…</>
            ) : (
              <><ArrowRight className="w-4 h-4" /> Release funds to my Stripe account</>
            )}
          </button>
          <p className="text-xs text-slate-500">
            Card payments need 1–2 business days to clear before transfer succeeds. ACH takes 3–5 business days.
          </p>
        </div>
      )}
    </SectionCard>
  );
}

function Stat({
  label,
  amount,
  accent,
}: {
  label: string;
  amount: number;
  accent: 'slate' | 'emerald';
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        accent === 'emerald'
          ? 'bg-emerald-50 border-emerald-200'
          : 'bg-slate-50 border-slate-200'
      }`}
    >
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className={`text-lg font-semibold ${accent === 'emerald' ? 'text-emerald-700' : 'text-slate-900'}`}>
        ${(amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
    </div>
  );
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return iso; }
}
