import { Eye, FileText } from 'lucide-react';
import { getPdfDownloadUrl } from '../../../lib/api';
import { openHtmlInTab } from '../shared/openHtmlInTab';

interface Props {
  caseId: string;
  html: string | null | undefined;
  downloadName: 'demand-letter' | 'final-notice' | 'court-form' | 'default-judgment' | 'affidavit-of-service' | 'settlement' | 'payment-plan';
  viewTitle: string;
  filename: string;
  onRegenerate: () => void;
  regenerateLabel?: string;
  extraActions?: React.ReactNode;
}

export default function DocumentActions({
  caseId,
  html,
  downloadName,
  viewTitle,
  filename,
  onRegenerate,
  regenerateLabel = 'Regenerate',
  extraActions,
}: Props) {
  if (!html) return null;
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {extraActions}
      <button
        onClick={() => openHtmlInTab(html, viewTitle)}
        className="btn-secondary text-sm"
      >
        <Eye className="w-4 h-4" /> View
      </button>
      <a
        href={getPdfDownloadUrl(caseId, downloadName)}
        download={filename}
        className="btn-primary text-sm"
      >
        <FileText className="w-4 h-4" /> Download PDF
      </a>
      <button onClick={onRegenerate} className="btn-ghost text-sm ml-auto">
        {regenerateLabel}
      </button>
    </div>
  );
}
