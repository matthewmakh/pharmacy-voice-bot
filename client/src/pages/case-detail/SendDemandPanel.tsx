import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, Mail, Truck, Check, AlertCircle, Loader2 } from 'lucide-react';
import { sendDemandLetter, type SendChannel } from '../../lib/api';
import type { Case } from '../../types';
import SectionCard from '../../components/ui/SectionCard';

export default function SendDemandPanel({ caseData }: { caseData: Case }) {
  const queryClient = useQueryClient();
  const [channels, setChannels] = React.useState<SendChannel[]>(() => {
    const c: SendChannel[] = [];
    if (caseData.debtorAddress) c.push('mail');
    if (caseData.debtorEmail) c.push('email');
    return c;
  });
  const [error, setError] = React.useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => sendDemandLetter(caseData.id, channels),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['case', caseData.id] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        || (err as Error)?.message
        || 'Send failed';
      setError(msg);
    },
  });

  const mailed = !!caseData.demandLetterMailedAt;
  const mailDelivered = !!caseData.demandLetterDeliveredAt;
  const emailed = !!caseData.demandLetterEmailedAt;
  const emailOpened = !!caseData.demandLetterEmailOpenedAt;
  const anySent = mailed || emailed;

  const toggle = (ch: SendChannel) =>
    setChannels((prev) => (prev.includes(ch) ? prev.filter((x) => x !== ch) : [...prev, ch]));

  return (
    <SectionCard
      title={<div className="flex items-center gap-2"><Send className="w-4 h-4 text-emerald-500" />Send Demand Letter</div>}
      description={anySent
        ? 'Demand letter has been sent. Tracking shown below.'
        : 'Send the demand letter to the debtor via certified mail (proof of delivery) and/or tracked email.'}
      collapsible
      defaultOpen={!anySent}
    >
      {anySent && (
        <div className="space-y-2 mb-4">
          {mailed && (
            <div className="flex items-center gap-2 text-sm">
              <Check className="w-4 h-4 text-emerald-500" />
              <Truck className="w-4 h-4 text-slate-500" />
              <span className="text-slate-700">Mailed {fmtDate(caseData.demandLetterMailedAt)}</span>
              {caseData.demandLetterTracking && (
                <span className="text-xs text-slate-500 ml-2">USPS #{caseData.demandLetterTracking}</span>
              )}
              {mailDelivered && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Delivered {fmtDate(caseData.demandLetterDeliveredAt)}
                </span>
              )}
            </div>
          )}
          {emailed && (
            <div className="flex items-center gap-2 text-sm">
              <Check className="w-4 h-4 text-emerald-500" />
              <Mail className="w-4 h-4 text-slate-500" />
              <span className="text-slate-700">Emailed {fmtDate(caseData.demandLetterEmailedAt)}</span>
              {emailOpened && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Opened {fmtDate(caseData.demandLetterEmailOpenedAt)}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {!anySent && (
        <div className="space-y-3">
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={channels.includes('mail')}
                onChange={() => toggle('mail')}
                disabled={!caseData.debtorAddress}
              />
              <Truck className="w-4 h-4 text-slate-500" />
              Certified mail RRR via Lob
              {!caseData.debtorAddress && (
                <span className="text-xs text-amber-600 ml-2">(no debtor address on file)</span>
              )}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={channels.includes('email')}
                onChange={() => toggle('email')}
                disabled={!caseData.debtorEmail}
              />
              <Mail className="w-4 h-4 text-slate-500" />
              Tracked email via Resend
              {!caseData.debtorEmail && (
                <span className="text-xs text-amber-600 ml-2">(no debtor email on file)</span>
              )}
            </label>
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={() => mutation.mutate()}
              disabled={channels.length === 0 || mutation.isPending}
              className="btn-primary"
            >
              {mutation.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
              ) : (
                <><Send className="w-4 h-4" /> Send {channelLabel(channels)}</>
              )}
            </button>
            <span className="text-xs text-slate-500">
              {channels.includes('mail') && '~$8 certified mail. '}
              {channels.includes('email') && 'Email is free.'}
            </span>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function channelLabel(channels: SendChannel[]): string {
  if (channels.length === 0) return '(no channel)';
  if (channels.length === 2) return 'via Mail + Email';
  return channels[0] === 'mail' ? 'via Certified Mail' : 'via Email';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}
