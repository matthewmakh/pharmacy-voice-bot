import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Send, Shield, Mail, Truck, Check, AlertCircle, Loader2 } from 'lucide-react';
import { generateFinalNotice, sendFinalNotice, type SendChannel } from '../../../lib/api';
import type { Case } from '../../../types';
import SectionCard from '../../../components/ui/SectionCard';
import { RotatingFact } from '../shared/RotatingFact';
import DocumentActions from './DocumentActions';

export default function PreFilingNotice({ caseData }: { caseData: Case }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const startedRef = React.useRef<Date | null>(null);
  const [channels, setChannels] = React.useState<SendChannel[]>(() => {
    const c: SendChannel[] = [];
    if (caseData.debtorAddress) c.push('mail');
    if (caseData.debtorEmail) c.push('email');
    return c;
  });
  const [sendError, setSendError] = React.useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => { startedRef.current = new Date(); return generateFinalNotice(caseData.id); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });

  const sendMutation = useMutation({
    mutationFn: () => sendFinalNotice(caseData.id, channels),
    onSuccess: () => {
      setSendError(null);
      queryClient.invalidateQueries({ queryKey: ['case', caseData.id] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        || (err as Error)?.message
        || 'Send failed';
      setSendError(msg);
    },
  });

  const handleCopy = () => {
    if (caseData.finalNotice) {
      navigator.clipboard.writeText(caseData.finalNotice);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const mailed = !!caseData.finalNoticeMailedAt;
  const mailDelivered = !!caseData.finalNoticeDeliveredAt;
  const emailed = !!caseData.finalNoticeEmailedAt;
  const anySent = mailed || emailed;

  const toggle = (ch: SendChannel) =>
    setChannels((prev) => (prev.includes(ch) ? prev.filter((x) => x !== ch) : [...prev, ch]));

  return (
    <SectionCard
      title={<div className="flex items-center gap-2"><Shield className="w-4 h-4 text-blue-500" />Pre-Filing Notice</div>}
      description="Send this before filing to give the debtor a final opportunity to pay and to document your escalation path."
      collapsible
      defaultOpen={!!caseData.finalNoticeHtml}
    >
      {mutation.isPending ? (
        <RotatingFact label="Generating pre-filing notice…" startedAt={startedRef.current ?? undefined} estimatedSeconds={20} />
      ) : caseData.finalNoticeHtml ? (
        <div className="space-y-4">
          <DocumentActions
            caseId={caseData.id}
            html={caseData.finalNoticeHtml}
            downloadName="final-notice"
            viewTitle="Pre-Filing Notice"
            filename="final-notice.pdf"
            onRegenerate={() => mutation.mutate()}
            extraActions={
              <button onClick={handleCopy} className="btn-secondary text-sm">
                <Copy className="w-4 h-4" /> {copied ? 'Copied!' : 'Copy Text'}
              </button>
            }
          />

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            {anySent ? (
              <div className="space-y-2">
                {mailed && (
                  <div className="flex items-center gap-2 text-sm">
                    <Check className="w-4 h-4 text-emerald-500" />
                    <Truck className="w-4 h-4 text-slate-500" />
                    <span className="text-slate-700">Mailed {fmtDate(caseData.finalNoticeMailedAt)}</span>
                    {caseData.finalNoticeTracking && (
                      <span className="text-xs text-slate-500 ml-2">USPS #{caseData.finalNoticeTracking}</span>
                    )}
                    {mailDelivered && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Delivered {fmtDate(caseData.finalNoticeDeliveredAt)}
                      </span>
                    )}
                  </div>
                )}
                {emailed && (
                  <div className="flex items-center gap-2 text-sm">
                    <Check className="w-4 h-4 text-emerald-500" />
                    <Mail className="w-4 h-4 text-slate-500" />
                    <span className="text-slate-700">Emailed {fmtDate(caseData.finalNoticeEmailedAt)}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-sm font-semibold text-slate-700">Send pre-filing notice</div>
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
                      <span className="text-xs text-amber-600 ml-2">(no debtor address)</span>
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
                      <span className="text-xs text-amber-600 ml-2">(no debtor email)</span>
                    )}
                  </label>
                </div>

                {sendError && (
                  <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>{sendError}</span>
                  </div>
                )}

                <button
                  onClick={() => sendMutation.mutate()}
                  disabled={channels.length === 0 || sendMutation.isPending}
                  className="btn-primary"
                >
                  {sendMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                  ) : (
                    <><Send className="w-4 h-4" /> Send Pre-Filing Notice</>
                  )}
                </button>
              </div>
            )}
          </div>

          <div className="card p-8">
            <div className="prose prose-sm max-w-none prose-slate" dangerouslySetInnerHTML={{ __html: caseData.finalNoticeHtml }} />
          </div>
        </div>
      ) : (
        <div className="text-center py-4">
          <p className="text-sm text-slate-500 mb-4">
            Generate a pre-filing notice — a short, firm letter stating legal action is imminent.
          </p>
          <button onClick={() => mutation.mutate()} className="btn-primary">Generate Pre-Filing Notice</button>
        </div>
      )}
    </SectionCard>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}
