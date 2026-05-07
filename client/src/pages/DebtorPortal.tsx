import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { CreditCard, Calendar, MessageSquare, Loader2, AlertCircle, Check } from 'lucide-react';
import {
  getPortalCase,
  filePortalDispute,
  proposePortalPlan,
  startPortalCheckout,
  type PortalCaseView,
} from '../lib/api';

type Tab = 'pay' | 'plan' | 'dispute';

export default function DebtorPortal() {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = React.useState<Tab>('pay');
  const [error, setError] = React.useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['portal', token],
    queryFn: () => getPortalCase(token),
    enabled: !!token,
    retry: false,
  });

  const checkoutMutation = useMutation({
    mutationFn: () => startPortalCheckout(token),
    onSuccess: (res) => { window.location.href = res.url; },
    onError: (err: unknown) => setError(extractError(err)),
  });

  if (isLoading) {
    return (
      <CenteredCard>
        <Loader2 className="w-6 h-6 animate-spin text-slate-400 mx-auto" />
        <p className="text-sm text-slate-500 text-center mt-2">Loading…</p>
      </CenteredCard>
    );
  }

  if (isError || !data) {
    return (
      <CenteredCard>
        <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
        <h2 className="text-lg font-semibold text-slate-900 text-center mt-2">Link not found</h2>
        <p className="text-sm text-slate-500 text-center mt-1">
          This response link is invalid or has expired. Contact the claimant if you need a new one.
        </p>
      </CenteredCard>
    );
  }

  if (data.alreadyPaid) {
    return (
      <CenteredCard>
        <Check className="w-10 h-10 text-emerald-500 mx-auto" />
        <h2 className="text-xl font-semibold text-slate-900 text-center mt-3">Payment received</h2>
        <p className="text-sm text-slate-500 text-center mt-1">
          You've paid this claim. Thank you. The claimant has been notified.
        </p>
      </CenteredCard>
    );
  }

  const amountStr = data.amountOwed
    ? `$${Number(data.amountOwed).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <header className="mb-6">
          <p className="text-xs uppercase tracking-wider text-slate-400 mb-1">Response Portal</p>
          <h1 className="text-2xl font-semibold text-slate-900">
            {data.claimantBusiness || data.claimantName} is requesting payment
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Amount: <strong className="text-slate-800">{amountStr}</strong>
            {data.invoiceNumber && <> · Invoice #{data.invoiceNumber}</>}
          </p>
          {data.serviceDescription && (
            <p className="text-sm text-slate-600 mt-3 leading-relaxed">{data.serviceDescription}</p>
          )}
        </header>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="flex border-b border-slate-200">
            <TabBtn active={tab === 'pay'} onClick={() => setTab('pay')} icon={<CreditCard className="w-4 h-4" />}>Pay now</TabBtn>
            <TabBtn active={tab === 'plan'} onClick={() => setTab('plan')} icon={<Calendar className="w-4 h-4" />}>Propose plan</TabBtn>
            <TabBtn active={tab === 'dispute'} onClick={() => setTab('dispute')} icon={<MessageSquare className="w-4 h-4" />}>Dispute</TabBtn>
          </div>

          <div className="p-6">
            {tab === 'pay' && (
              <PayTab
                amountStr={amountStr}
                isPending={checkoutMutation.isPending}
                onPay={() => checkoutMutation.mutate()}
                error={error}
              />
            )}
            {tab === 'plan' && data && (
              <PlanTab token={token} data={data} onSuccess={() => navigate('/respond/submitted')} />
            )}
            {tab === 'dispute' && data && (
              <DisputeTab token={token} disputed={data.disputed} onSuccess={() => navigate('/respond/submitted')} />
            )}
          </div>
        </div>

        <p className="text-xs text-slate-400 text-center mt-6">
          Powered by Reclaim · Secure response link
        </p>
      </div>
    </div>
  );
}

// ─── Components ──────────────────────────────────────────────────────────────

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 max-w-md w-full">
        {children}
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
        active
          ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function PayTab({
  amountStr,
  isPending,
  onPay,
  error,
}: {
  amountStr: string;
  isPending: boolean;
  onPay: () => void;
  error: string | null;
}) {
  return (
    <div>
      <h3 className="text-base font-semibold text-slate-900 mb-1">Pay {amountStr}</h3>
      <p className="text-sm text-slate-500 mb-4">
        Pay by card or US bank transfer. Closes the claim immediately.
      </p>
      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2 mb-3">{error}</div>
      )}
      <button onClick={onPay} disabled={isPending} className="btn-primary w-full">
        {isPending ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Opening checkout…</>
        ) : (
          <><CreditCard className="w-4 h-4" /> Pay {amountStr}</>
        )}
      </button>
    </div>
  );
}

function PlanTab({
  token,
  data,
  onSuccess,
}: {
  token: string;
  data: PortalCaseView;
  onSuccess: () => void;
}) {
  const [monthly, setMonthly] = React.useState('');
  const [months, setMonths] = React.useState('6');
  const [notes, setNotes] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => proposePortalPlan(token, {
      monthlyAmount: Number(monthly),
      numberOfPayments: Number(months),
      notes: notes || undefined,
    }),
    onSuccess,
    onError: (err: unknown) => setError(extractError(err)),
  });

  if (data.proposedPlan) {
    return (
      <p className="text-sm text-slate-600">
        Your payment plan proposal has been sent to the claimant. They'll respond within a few business days.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-slate-900">Propose a payment plan</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Monthly amount</label>
          <input
            type="number"
            inputMode="decimal"
            min="1"
            step="0.01"
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
            placeholder="500"
            className="input"
          />
        </div>
        <div>
          <label className="label">Number of payments</label>
          <input
            type="number"
            min="2"
            max="36"
            value={months}
            onChange={(e) => setMonths(e.target.value)}
            className="input"
          />
        </div>
      </div>
      <div>
        <label className="label">Notes (optional)</label>
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any context the claimant should know"
          className="input"
        />
      </div>
      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>
      )}
      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || !monthly || !months}
        className="btn-primary w-full"
      >
        {mutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : 'Send proposal'}
      </button>
    </div>
  );
}

function DisputeTab({
  token,
  disputed,
  onSuccess,
}: {
  token: string;
  disputed: boolean;
  onSuccess: () => void;
}) {
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => filePortalDispute(token, reason),
    onSuccess,
    onError: (err: unknown) => setError(extractError(err)),
  });

  if (disputed) {
    return (
      <p className="text-sm text-slate-600">
        Your dispute has been logged and the claimant has been notified. They may contact you to discuss.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-slate-900">Dispute this claim</h3>
      <p className="text-sm text-slate-500">
        Explain why you don't believe this amount is owed. The claimant will see this response.
      </p>
      <textarea
        rows={6}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="I dispute this charge because…"
        className="input"
      />
      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>
      )}
      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || reason.trim().length < 10}
        className="btn-primary w-full"
      >
        {mutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</> : 'Submit dispute'}
      </button>
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
