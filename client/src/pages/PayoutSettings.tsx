import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { CreditCard, Check, AlertCircle, Loader2, ExternalLink } from 'lucide-react';
import { getPayoutStatus, startStripeOnboarding } from '../lib/api';

export default function PayoutSettings() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const justOnboarded = searchParams.get('onboarded') === '1';
  const [error, setError] = React.useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ['payouts', 'status'],
    queryFn: getPayoutStatus,
    refetchInterval: justOnboarded ? 3000 : false,
  });

  const onboardMutation = useMutation({
    mutationFn: startStripeOnboarding,
    onSuccess: (res) => { window.location.href = res.onboardingUrl; },
    onError: (err: unknown) => setError(extractError(err)),
  });

  const status = statusQuery.data;

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Payout settings</h1>
        <p className="text-sm text-slate-500 mt-1">
          Connect your Stripe account so collected funds can be paid out to you.
        </p>
      </header>

      {justOnboarded && (
        <div className="mb-6 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg p-3 text-sm">
          Onboarding submitted. Stripe is verifying your account — this usually takes a minute.
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        {statusQuery.isLoading ? (
          <div className="flex items-center gap-2 text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : !status?.accountId ? (
          <NotStarted
            isPending={onboardMutation.isPending}
            onStart={() => { setError(null); onboardMutation.mutate(); }}
          />
        ) : status.chargesEnabled && status.payoutsEnabled ? (
          <Active accountId={status.accountId} />
        ) : (
          <Pending
            accountId={status.accountId}
            chargesEnabled={status.chargesEnabled}
            payoutsEnabled={status.payoutsEnabled}
            detailsSubmitted={status.detailsSubmitted}
            isPending={onboardMutation.isPending}
            onResume={() => { setError(null); onboardMutation.mutate(); }}
          />
        )}

        {error && (
          <div className="mt-4 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="mt-6 text-xs text-slate-500 leading-relaxed">
        <p className="mb-2">
          <strong>How payouts work:</strong> when a debtor pays through their response portal, the
          payment lands in Reclaim's escrow first. Reclaim retains a 12% recovery fee and transfers
          the remaining 88% to your connected Stripe account, typically within 1–2 business days
          after the payment clears.
        </p>
        <p>
          Stripe handles identity verification, banking details, and tax forms (1099-K). Reclaim
          never sees your bank account credentials.
        </p>
      </div>
    </div>
  );
}

function NotStarted({ isPending, onStart }: { isPending: boolean; onStart: () => void }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <CreditCard className="w-5 h-5 text-slate-400" />
        <div className="font-semibold text-slate-900">Not connected</div>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Onboarding takes ~3 minutes. You'll need your business details, an SSN or EIN, and a US
        bank account.
      </p>
      <button onClick={onStart} disabled={isPending} className="btn-primary">
        {isPending ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Opening Stripe…</>
        ) : (
          <><ExternalLink className="w-4 h-4" /> Start Stripe onboarding</>
        )}
      </button>
    </div>
  );
}

function Pending({
  accountId,
  chargesEnabled,
  payoutsEnabled,
  detailsSubmitted,
  isPending,
  onResume,
}: {
  accountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  isPending: boolean;
  onResume: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <Loader2 className="w-5 h-5 text-amber-500" />
        <div className="font-semibold text-slate-900">Onboarding in progress</div>
      </div>
      <ul className="space-y-2 text-sm text-slate-600 mb-4">
        <li className="flex items-center gap-2">
          {detailsSubmitted ? <Check className="w-4 h-4 text-emerald-500" /> : <span className="w-4 h-4 inline-block" />}
          Account details submitted
        </li>
        <li className="flex items-center gap-2">
          {chargesEnabled ? <Check className="w-4 h-4 text-emerald-500" /> : <span className="w-4 h-4 inline-block" />}
          Charges enabled
        </li>
        <li className="flex items-center gap-2">
          {payoutsEnabled ? <Check className="w-4 h-4 text-emerald-500" /> : <span className="w-4 h-4 inline-block" />}
          Payouts enabled
        </li>
      </ul>
      <p className="text-xs text-slate-500 mb-4">
        Connect account <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">{accountId}</code>
      </p>
      <button onClick={onResume} disabled={isPending} className="btn-primary">
        {isPending ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Opening Stripe…</>
        ) : (
          <><ExternalLink className="w-4 h-4" /> Resume onboarding</>
        )}
      </button>
    </div>
  );
}

function Active({ accountId }: { accountId: string }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <Check className="w-5 h-5 text-emerald-500" />
        <div className="font-semibold text-slate-900">Connected</div>
      </div>
      <p className="text-sm text-slate-600">
        Your Stripe account is verified and ready to accept payouts.
      </p>
      <p className="text-xs text-slate-400 mt-3">
        Account <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">{accountId}</code>
      </p>
    </div>
  );
}

function extractError(err: unknown): string {
  return (
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error
    || (err as Error)?.message
    || 'Something went wrong'
  );
}
