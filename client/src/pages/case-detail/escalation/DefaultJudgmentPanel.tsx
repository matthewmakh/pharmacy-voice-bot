import React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Scale, FileCheck, Check, Loader2, AlertCircle } from 'lucide-react';
import { generateDefaultJudgment, markDefaultJudgmentFiled, type FilingMethod } from '../../../lib/api';
import type { Case } from '../../../types';
import SectionCard from '../../../components/ui/SectionCard';
import Alert from '../../../components/ui/Alert';
import { RotatingFact } from '../shared/RotatingFact';
import { VerificationPanel } from '../shared/VerificationPanel';
import DocumentActions from './DocumentActions';

export default function DefaultJudgmentPanel({ caseData }: { caseData: Case }) {
  const queryClient = useQueryClient();
  const startedRef = React.useRef<Date | null>(null);

  const mutation = useMutation({
    mutationFn: () => { startedRef.current = new Date(); return generateDefaultJudgment(caseData.id); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });

  const svcAction = caseData.actions.find(a => a.type === 'SERVICE_INITIATED');
  const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <SectionCard
      title={<div className="flex items-center gap-2"><Scale className="w-4 h-4 text-slate-500" />Default Judgment Motion</div>}
      collapsible
      defaultOpen={!!caseData.defaultJudgmentHtml}
    >
      {!svcAction ? (
        <Alert tone="neutral">
          Log service initiation in the <strong>Process Server Engagement</strong> section above first. Once service is logged, return here after the answer deadline has passed if the defendant does not respond.
        </Alert>
      ) : (() => {
        const svcDate = new Date(svcAction.createdAt);
        const altDeadline = new Date(svcDate); altDeadline.setDate(altDeadline.getDate() + 30);
        const today = new Date();
        const canFileDefault = today > altDeadline;
        const daysUntil = Math.ceil((altDeadline.getTime() - today.getTime()) / 86400000);

        if (!canFileDefault) {
          return (
            <Alert tone="warning">
              The answer deadline has not yet passed. The defendant has until <strong>{fmtDate(altDeadline)}</strong> ({daysUntil} {daysUntil === 1 ? 'day' : 'days'} from now) to respond. Return here after that date if no answer is filed.
            </Alert>
          );
        }

        return (
          <>
            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              The answer deadline has passed. If the defendant has not appeared or answered, you can move for a default judgment. Service was initiated on {fmtDate(svcDate)}; the 30-day answer deadline was {fmtDate(altDeadline)}.
            </p>
            {mutation.isPending ? (
              <RotatingFact label="Generating default judgment motion…" startedAt={startedRef.current ?? undefined} estimatedSeconds={30} />
            ) : caseData.defaultJudgmentHtml ? (
              <div className="space-y-4">
                <DocumentActions
                  caseId={caseData.id}
                  html={caseData.defaultJudgmentHtml}
                  downloadName="default-judgment"
                  viewTitle="Default Judgment Motion"
                  filename="default-judgment-motion.pdf"
                  onRegenerate={() => mutation.mutate()}
                />
                <FilingActions caseData={caseData} />
                {caseData.defaultJudgmentVerification && (
                  <VerificationPanel verification={caseData.defaultJudgmentVerification} />
                )}
                <div className="card p-8">
                  <div className="prose prose-sm max-w-none prose-slate" dangerouslySetInnerHTML={{ __html: caseData.defaultJudgmentHtml }} />
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-sm text-slate-500 mb-4">
                  Generate a Motion for Default Judgment package — Notice of Motion, Affidavit in Support, Proposed Order, and blank Affidavit of Service template.
                </p>
                <button onClick={() => mutation.mutate()} className="btn-primary">
                  Generate Default Judgment Motion
                </button>
              </div>
            )}
          </>
        );
      })()}
    </SectionCard>
  );
}

// ─── FilingActions ───────────────────────────────────────────────────────────

function FilingActions({ caseData }: { caseData: Case }) {
  const queryClient = useQueryClient();
  const [showMark, setShowMark] = React.useState(false);
  const [method, setMethod] = React.useState<FilingMethod>('manual');
  const [indexNumber, setIndexNumber] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const filed = !!caseData.defaultJudgmentFiledAt;

  const mutation = useMutation({
    mutationFn: () =>
      markDefaultJudgmentFiled(caseData.id, {
        method,
        indexNumber: indexNumber.trim() || undefined,
      }),
    onSuccess: () => {
      setShowMark(false);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['case', caseData.id] });
    },
    onError: (err: unknown) => {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        || (err as Error)?.message
        || 'Failed to mark as filed',
      );
    },
  });

  if (filed) {
    const fmtDate = (d: string | null) =>
      d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    const methodLabel = {
      diy: 'filed yourself (NYSCEF/EDDS)',
      infotrack: 'filed via InfoTrack',
      attorney: 'handed off to attorney',
      manual: 'logged manually',
    }[caseData.defaultJudgmentFilingMethod || 'manual'];

    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-emerald-800">
          <Check className="w-4 h-4" />
          Default judgment {methodLabel} on {fmtDate(caseData.defaultJudgmentFiledAt)}
        </div>
        {caseData.defaultJudgmentIndexNumber && (
          <div className="text-xs text-emerald-700 mt-1 ml-6">Index #{caseData.defaultJudgmentIndexNumber}</div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <FileCheck className="w-4 h-4 text-slate-500" />
        <div className="text-sm font-semibold text-slate-700">File this motion</div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
        <div className="rounded border border-slate-200 bg-white p-3">
          <div className="font-semibold text-slate-700 mb-1">Pay $200, we file it</div>
          <p className="text-slate-500 mb-2 leading-relaxed">Reclaim files via InfoTrack to NYSCEF/EDDS. Coming soon in Phase B.</p>
          <button disabled className="btn-secondary text-xs opacity-50 cursor-not-allowed w-full">Coming soon</button>
        </div>
        <div className="rounded border border-slate-200 bg-white p-3">
          <div className="font-semibold text-slate-700 mb-1">File it yourself (free)</div>
          <p className="text-slate-500 mb-2 leading-relaxed">Step-by-step walkthrough for NYSCEF, EDDS, or in-person Commercial Claims filing.</p>
          <Link
            to={`/cases/${caseData.id}/walkthrough?purpose=default-judgment`}
            className="btn-secondary text-xs w-full justify-center"
          >
            Walk me through it →
          </Link>
        </div>
        <div className="rounded border border-slate-200 bg-white p-3">
          <div className="font-semibold text-slate-700 mb-1">Hand off to attorney</div>
          <p className="text-slate-500 mb-2 leading-relaxed">Package case + drafts and route to a partner attorney. Coming soon in Phase B.</p>
          <button disabled className="btn-secondary text-xs opacity-50 cursor-not-allowed w-full">Coming soon</button>
        </div>
      </div>

      {!showMark ? (
        <button onClick={() => setShowMark(true)} className="btn-ghost text-xs">
          Already filed it? Log it manually →
        </button>
      ) : (
        <div className="rounded border border-slate-200 bg-white p-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="label">Filing method</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as FilingMethod)}
                className="input text-sm"
              >
                <option value="manual">Manual log</option>
                <option value="diy">DIY (NYSCEF / EDDS / in person)</option>
                <option value="attorney">My attorney filed it</option>
              </select>
            </div>
            <div>
              <label className="label">Index number (optional)</label>
              <input
                type="text"
                value={indexNumber}
                onChange={(e) => setIndexNumber(e.target.value)}
                placeholder="e.g. 156789/2025"
                className="input text-sm"
              />
            </div>
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
              disabled={mutation.isPending}
              className="btn-primary text-sm"
            >
              {mutation.isPending ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
              ) : (
                'Save'
              )}
            </button>
            <button onClick={() => setShowMark(false)} className="btn-ghost text-sm">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
