import { useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { downloadPdf, getErrorMessage, type PdfType } from '../../../lib/api';

/**
 * Downloads a server-generated PDF via the authenticated API (no token in the URL).
 * Shows a spinner while the server renders and surfaces any error inline.
 */
export function PdfDownloadButton({
  caseId,
  type,
  filename,
  label = 'Download PDF',
  size = 'sm',
}: {
  caseId: string;
  type: PdfType;
  filename: string;
  label?: string;
  size?: 'sm' | 'xs';
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cls = size === 'xs' ? 'btn-primary text-xs' : 'btn-primary text-sm';
  const icon = size === 'xs' ? 'w-3.5 h-3.5' : 'w-4 h-4';

  async function go() {
    setBusy(true);
    setErr(null);
    try {
      await downloadPdf(caseId, type, filename);
    } catch (e) {
      setErr(getErrorMessage(e, 'Could not generate the PDF. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button onClick={go} disabled={busy} className={cls}>
        {busy ? <Loader2 className={`${icon} animate-spin`} /> : <FileText className={icon} />}
        {busy ? 'Preparing…' : label}
      </button>
      {err && <span className="w-full text-xs text-red-600">{err}</span>}
    </>
  );
}
