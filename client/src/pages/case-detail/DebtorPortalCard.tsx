import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link as LinkIcon, Copy, ExternalLink, Loader2, Eye } from 'lucide-react';
import { generatePortalToken } from '../../lib/api';
import type { Case } from '../../types';
import SectionCard from '../../components/ui/SectionCard';

export default function DebtorPortalCard({ caseData }: { caseData: Case }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = React.useState(false);

  const url = caseData.portalToken
    ? `${window.location.origin}/respond/${caseData.portalToken}`
    : null;

  const mutation = useMutation({
    mutationFn: () => generatePortalToken(caseData.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });

  const handleCopy = () => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <SectionCard
      title={
        <div className="flex items-center gap-2">
          <LinkIcon className="w-4 h-4 text-blue-500" />
          Debtor Response Link
        </div>
      }
      description="A magic link the debtor uses to pay, propose a payment plan, or dispute. The demand letter email already includes this link — generate one here only if you want to share it via SMS or another channel."
      collapsible
      defaultOpen={false}
    >
      {url ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={url}
              className="input flex-1 text-xs font-mono"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button onClick={handleCopy} className="btn-secondary text-sm">
              <Copy className="w-3.5 h-3.5" /> {copied ? 'Copied' : 'Copy'}
            </button>
            <a href={url} target="_blank" rel="noreferrer" className="btn-secondary text-sm">
              <ExternalLink className="w-3.5 h-3.5" /> Open
            </a>
          </div>
          {caseData.portalLastViewedAt && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Eye className="w-3.5 h-3.5" />
              Debtor last viewed {fmtDateTime(caseData.portalLastViewedAt)}
            </div>
          )}
          {caseData.portalTokenExpiresAt && (
            <div className="text-xs text-slate-400">
              Link expires {fmtDate(caseData.portalTokenExpiresAt)}
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="btn-secondary text-sm"
        >
          {mutation.isPending ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…</>
          ) : (
            <><LinkIcon className="w-3.5 h-3.5" /> Generate response link</>
          )}
        </button>
      )}
    </SectionCard>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return iso; }
}
