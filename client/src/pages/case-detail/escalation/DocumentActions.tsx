import { useState } from 'react';
import { Eye, FileText, Loader2 } from 'lucide-react';
import { downloadPdf, getErrorMessage, type PdfType } from '../../../lib/api';
import { openHtmlInTab } from '../shared/openHtmlInTab';

interface Props {
  caseId: string;
  html: string | null | undefined;
  downloadName: PdfType;
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
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!html) return null;

  async function handleDownload() {
    setDownloading(true);
    setError(null);
    try {
      await downloadPdf(caseId, downloadName, filename);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not generate the PDF. Please try again.'));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {extraActions}
      <button onClick={() => openHtmlInTab(html, viewTitle)} className="btn-secondary text-sm">
        <Eye className="w-4 h-4" /> View
      </button>
      <button onClick={handleDownload} disabled={downloading} className="btn-primary text-sm">
        {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
        {downloading ? 'Preparing…' : 'Download PDF'}
      </button>
      <button onClick={onRegenerate} className="btn-ghost text-sm ml-auto">
        {regenerateLabel}
      </button>
      {error && <span className="w-full text-xs text-red-600">{error}</span>}
    </div>
  );
}
