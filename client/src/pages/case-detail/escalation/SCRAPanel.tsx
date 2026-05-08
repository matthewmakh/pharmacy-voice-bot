import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, ExternalLink, Check, FileText, Eye, Loader2, AlertCircle, Stamp } from 'lucide-react';
import { generateSCRAAffidavit, markSCRAVerified, requestNotarization } from '../../../lib/api';
import type { Case } from '../../../types';
import SectionCard from '../../../components/ui/SectionCard';
import { openHtmlInTab } from '../shared/openHtmlInTab';

const DOD_URL = 'https://scra.dmdc.osd.mil/scra/#/single-record';

export default function SCRAPanel({ caseData }: { caseData: Case }) {
  const queryClient = useQueryClient();
  const [showVerify, setShowVerify] = React.useState(false);
  const [certificateNumber, setCertificateNumber] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const generateMutation = useMutation({
    mutationFn: () => generateSCRAAffidavit(caseData.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });

  const notarizeMutation = useMutation({
    mutationFn: () => requestNotarization(caseData.id, 'scra-affidavit'),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['case', caseData.id] });
      if (res.signerUrl) window.open(res.signerUrl, '_blank');
    },
    onError: (err: unknown) => {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        || (err as Error)?.message
        || 'Notarization failed',
      );
    },
  });

  const verifyMutation = useMutation({
    mutationFn: () => markSCRAVerified(caseData.id, certificateNumber.trim() || undefined),
    onSuccess: () => {
      setShowVerify(false);
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

  const verified = !!caseData.scraVerifiedAt;
  const generated = !!caseData.scraAffidavitHtml;

  return (
    <SectionCard
      title={
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-amber-500" />
          SCRA Non-Military Affidavit
        </div>
      }
      description="Required by 50 U.S.C. § 3931 before a court will enter default judgment against an individual. Verifies the defendant is not on active military duty."
      collapsible
      defaultOpen={generated || verified}
    >
      <div className="space-y-3">
        {/* Step 1: lookup */}
        <Step
          done={verified}
          number={1}
          title="Run the DOD lookup"
          body={
            verified ? (
              <p className="text-xs text-emerald-700">
                Verified {fmtDate(caseData.scraVerifiedAt)}
                {caseData.scraCertificateNumber && ` · Certificate #${caseData.scraCertificateNumber}`}
              </p>
            ) : (
              <>
                <p className="text-xs text-slate-500 leading-relaxed mb-2">
                  Search by debtor name + DOB at the DOD's free portal. You'll get a Status Report PDF — save it; you'll attach it as Exhibit A to the affidavit.
                </p>
                <a href={DOD_URL} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
                  <ExternalLink className="w-3.5 h-3.5" /> Open DOD SCRA Portal
                </a>
                {!showVerify ? (
                  <button onClick={() => setShowVerify(true)} className="btn-ghost text-xs ml-2">
                    I've completed the lookup →
                  </button>
                ) : (
                  <div className="mt-3 rounded border border-slate-200 bg-white p-3 space-y-2">
                    <input
                      type="text"
                      value={certificateNumber}
                      onChange={(e) => setCertificateNumber(e.target.value)}
                      placeholder="Certificate number (optional)"
                      className="input text-sm"
                    />
                    {error && (
                      <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
                        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>{error}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => verifyMutation.mutate()}
                        disabled={verifyMutation.isPending}
                        className="btn-primary text-xs"
                      >
                        {verifyMutation.isPending ? (
                          <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                        ) : (
                          <><Check className="w-3.5 h-3.5" /> Mark verified</>
                        )}
                      </button>
                      <button onClick={() => setShowVerify(false)} className="btn-ghost text-xs">Cancel</button>
                    </div>
                  </div>
                )}
              </>
            )
          }
        />

        {/* Step 2: affidavit */}
        <Step
          done={generated}
          number={2}
          title="Generate the affidavit"
          body={
            generated ? (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => openHtmlInTab(caseData.scraAffidavitHtml!, 'SCRA Affidavit')}
                  className="btn-secondary text-xs"
                >
                  <Eye className="w-3.5 h-3.5" /> View
                </button>
                <button
                  onClick={() => generateMutation.mutate()}
                  disabled={generateMutation.isPending}
                  className="btn-ghost text-xs"
                >
                  Regenerate
                </button>
              </div>
            ) : (
              <button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                className="btn-primary text-xs"
              >
                {generateMutation.isPending ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…</>
                ) : (
                  <><FileText className="w-3.5 h-3.5" /> Generate SCRA Affidavit</>
                )}
              </button>
            )
          }
        />

        {/* Step 3: notarize */}
        <Step
          done={!!caseData.notarizedAt}
          number={3}
          title="Notarize the affidavit"
          body={
            caseData.notarizedAt ? (
              <div className="text-xs text-emerald-700">
                Notarized {fmtDate(caseData.notarizedAt)} via Proof
                {caseData.notarizedPdfUrl && (
                  <> · <a href={caseData.notarizedPdfUrl} target="_blank" rel="noreferrer" className="underline">View signed PDF</a></>
                )}
              </div>
            ) : caseData.notarizationStatus === 'in-session' || caseData.notarizationStatus === 'pending' ? (
              <p className="text-xs text-slate-500">RON session in progress — check email for the signer link.</p>
            ) : (
              <>
                <p className="text-xs text-slate-500 leading-relaxed mb-2">
                  Online notary via Proof — ~10 minutes, complete from your computer with a webcam. Or print and use a local notary.
                </p>
                <button
                  onClick={() => notarizeMutation.mutate()}
                  disabled={!generated || notarizeMutation.isPending}
                  className="btn-secondary text-xs"
                >
                  {notarizeMutation.isPending ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Starting…</>
                  ) : (
                    <><Stamp className="w-3.5 h-3.5" /> Notarize online via Proof</>
                  )}
                </button>
              </>
            )
          }
          last
        />
      </div>
    </SectionCard>
  );
}

function Step({
  done,
  number,
  title,
  body,
  last = false,
}: {
  done: boolean;
  number: number;
  title: string;
  body: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
            done
              ? 'bg-emerald-500 text-white'
              : 'bg-slate-100 text-slate-500 border border-slate-300'
          }`}
        >
          {done ? <Check className="w-3.5 h-3.5" /> : number}
        </div>
        {!last && <div className="w-px flex-1 bg-slate-200 mt-1" />}
      </div>
      <div className={`flex-1 pb-4 ${done ? 'opacity-70' : ''}`}>
        <div className="text-sm font-semibold text-slate-700 mb-1">{title}</div>
        <div>{body}</div>
      </div>
    </div>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}
