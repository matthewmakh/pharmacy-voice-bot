import React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Scale, ArrowRight, Loader2, Check } from 'lucide-react';
import { generateCourtForm, fileViaInfoTrack } from '../../../lib/api';
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
          <FilingActionsRow caseData={caseData} courtTrack={courtTrack} />
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

// ─── FilingActionsRow ────────────────────────────────────────────────────────

function FilingActionsRow({ caseData, courtTrack }: { caseData: import('../../../types').Case; courtTrack: 'commercial' | 'civil' | 'supreme' }) {
  const queryClient = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => fileViaInfoTrack(caseData.id, 'complaint'),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['case', caseData.id] });
    },
    onError: (err: unknown) => {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        || (err as Error)?.message
        || 'Failed',
      );
    },
  });

  // Already filed via InfoTrack
  if (caseData.infoTrackOrderId && caseData.infoTrackPurpose === 'complaint') {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
        <div className="text-sm font-medium text-emerald-900 flex items-center gap-2">
          <Check className="w-4 h-4" /> Filed via InfoTrack — status: <strong>{caseData.infoTrackStatus}</strong>
          {caseData.infoTrackIndexNumber && <> · Index #{caseData.infoTrackIndexNumber}</>}
        </div>
        {caseData.infoTrackRejectionReason && (
          <div className="text-xs text-red-700 mt-1">Rejected: {caseData.infoTrackRejectionReason}</div>
        )}
      </div>
    );
  }

  const walkthroughType = courtTrack === 'commercial' ? 'commercial-claims' : courtTrack === 'civil' ? 'edds' : 'nyscef';

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
      <div className="text-sm font-semibold text-slate-700">File this with the court</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {courtTrack !== 'commercial' && (
          <div className="rounded border border-slate-200 bg-white p-3">
            <div className="font-semibold text-slate-700 text-xs mb-1">Pay $200 + court fee — we file it</div>
            <p className="text-xs text-slate-500 mb-2 leading-relaxed">Reclaim files via InfoTrack to {courtTrack === 'civil' ? 'EDDS' : 'NYSCEF'}.</p>
            <button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="btn-primary text-xs w-full"
            >
              {mutation.isPending ? <><Loader2 className="w-3 h-3 animate-spin" /> Submitting…</> : 'File via InfoTrack'}
            </button>
            {error && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 mt-2">{error}</div>
            )}
          </div>
        )}
        <div className="rounded border border-slate-200 bg-white p-3">
          <div className="font-semibold text-slate-700 text-xs mb-1">File it yourself (free)</div>
          <p className="text-xs text-slate-500 mb-2 leading-relaxed">
            {courtTrack === 'commercial'
              ? 'In-person at your borough\'s clerk window.'
              : `Step-by-step walkthrough for ${courtTrack === 'civil' ? 'EDDS' : 'NYSCEF'}.`}
          </p>
          <Link
            to={`/cases/${caseData.id}/walkthrough?purpose=complaint&type=${walkthroughType}`}
            className="btn-secondary text-xs w-full justify-center"
          >
            Walk me through it <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}
