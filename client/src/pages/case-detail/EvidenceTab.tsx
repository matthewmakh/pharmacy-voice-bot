import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, FileText, Loader2, Trash2, Eye, X, Download } from 'lucide-react';
import {
  uploadDocuments,
  deleteDocument,
  reanalyzeDocument,
  getDocumentBlobUrl,
  downloadDocument,
  getErrorMessage,
} from '../../lib/api';
import { formatDate, formatFileSize, DOC_CLASSIFICATION_LABELS, DOC_CLASSIFICATION_TONES } from '../../lib/utils';
import type { Case, Document } from '../../types';
import UploadZone from '../../components/evidence/UploadZone';
import Badge from '../../components/ui/Badge';
import Alert from '../../components/ui/Alert';
import EmptyState from '../../components/ui/EmptyState';

// A document still analyzing after this long is probably stuck (e.g. a server restart
// mid-job) — offer a retry instead of an indefinite spinner.
const STUCK_AFTER_MS = 3 * 60 * 1000;

export default function EvidenceTab({ caseData, onRefresh }: { caseData: Case; onRefresh: () => void }) {
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<Document | null>(null);

  const handleUpload = async (files: File[]) => {
    setUploading(true);
    setUploadError(null);
    try {
      await uploadDocuments(caseData.id, files);
      queryClient.invalidateQueries({ queryKey: ['case', caseData.id] });
      onRefresh();
    } catch (err) {
      setUploadError(getErrorMessage(err, 'Upload failed — please try again.'));
    } finally {
      setUploading(false);
    }
  };

  const deleteMutation = useMutation({
    mutationFn: (docId: string) => deleteDocument(caseData.id, docId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });

  const reanalyzeMutation = useMutation({
    mutationFn: (docId: string) => reanalyzeDocument(caseData.id, docId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });

  return (
    <div className="space-y-6">
      <UploadZone onUpload={handleUpload} uploading={uploading} />
      {uploadError && <Alert tone="danger" title="Upload failed">{uploadError}</Alert>}

      {caseData.documents.length > 0 ? (
        <div className="card divide-y divide-border">
          {caseData.documents.map((doc) => {
            const pending = doc.classification === null && !doc.analysisError;
            const stuck = pending && Date.now() - new Date(doc.uploadedAt).getTime() > STUCK_AFTER_MS;
            return (
              <div key={doc.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
                <FileText className="w-5 h-5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{doc.originalName}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {formatFileSize(doc.size)} · {formatDate(doc.uploadedAt)}
                  </div>
                </div>
                {doc.analysisError ? (
                  <div className="flex items-center gap-2">
                    <Badge tone="danger" icon={<AlertCircle className="w-3 h-3" />}>Analysis failed</Badge>
                    <button onClick={() => reanalyzeMutation.mutate(doc.id)} disabled={reanalyzeMutation.isPending} className="text-xs text-blue-600 hover:text-blue-700 underline disabled:opacity-50">Retry</button>
                  </div>
                ) : pending ? (
                  <div className="flex items-center gap-2">
                    <Badge tone="neutral" icon={<Loader2 className="w-3 h-3 animate-spin" />}>Analyzing…</Badge>
                    {stuck && (
                      <button onClick={() => reanalyzeMutation.mutate(doc.id)} disabled={reanalyzeMutation.isPending} className="text-xs text-blue-600 hover:text-blue-700 underline disabled:opacity-50">Taking too long — retry</button>
                    )}
                  </div>
                ) : (
                  <Badge tone={DOC_CLASSIFICATION_TONES[doc.classification!] ?? 'neutral'}>
                    {DOC_CLASSIFICATION_LABELS[doc.classification!] ?? doc.classification}
                  </Badge>
                )}
                <button onClick={() => setPreviewDoc(doc)} className="p-1.5 text-muted-foreground hover:text-blue-600 transition-colors" title="Preview" aria-label={`Preview ${doc.originalName}`}>
                  <Eye className="w-4 h-4" />
                </button>
                <button onClick={() => deleteMutation.mutate(doc.id)} disabled={deleteMutation.isPending} className="p-1.5 text-muted-foreground hover:text-red-500 transition-colors" title="Delete" aria-label={`Delete ${doc.originalName}`}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <EmptyState
            icon={<FileText className="w-6 h-6" />}
            title="No documents yet"
            description="Upload contracts, invoices, emails, and other evidence using the uploader above."
          />
        </div>
      )}

      {previewDoc && (
        <PreviewModal
          caseId={caseData.id}
          doc={previewDoc}
          onClose={() => setPreviewDoc(null)}
          onDelete={() => { deleteMutation.mutate(previewDoc.id); setPreviewDoc(null); }}
        />
      )}
    </div>
  );
}

function PreviewModal({ caseId, doc, onClose, onDelete }: { caseId: string; doc: Document; onClose: () => void; onDelete: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Close on Escape; focus the close button on open.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Fetch the file as an authenticated blob for inline preview.
  const previewable = doc.mimeType.startsWith('image/') || doc.mimeType === 'application/pdf';
  useEffect(() => {
    if (!previewable) return;
    let url: string | null = null;
    let cancelled = false;
    setError(null);
    getDocumentBlobUrl(caseId, doc.id)
      .then((u) => { if (cancelled) { URL.revokeObjectURL(u); return; } url = u; setBlobUrl(u); })
      .catch((err) => { if (!cancelled) setError(getErrorMessage(err, 'Could not load this file.')); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [caseId, doc.id, previewable]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Preview: ${doc.originalName}`}>
      <div className="bg-card rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col m-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="text-sm font-semibold text-foreground truncate">{doc.originalName}</div>
          <button ref={closeRef} onClick={onClose} className="p-1 text-muted-foreground hover:text-muted-foreground" aria-label="Close preview">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-6">
          {error ? (
            <div className="text-sm text-red-600 text-center py-12">{error}</div>
          ) : !previewable ? (
            <div className="text-sm text-muted-foreground text-center py-12">Preview isn't available for this file type — use Download to open it.</div>
          ) : !blobUrl ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : doc.mimeType.startsWith('image/') ? (
            <img src={blobUrl} alt={doc.originalName} className="max-w-full mx-auto rounded-lg" />
          ) : (
            <iframe src={blobUrl} className="w-full h-[70vh] rounded-lg border border-border" title={doc.originalName} />
          )}
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
          <button onClick={() => downloadDocument(caseId, doc.id, doc.originalName).catch(() => {})} className="btn-secondary">
            <Download className="w-4 h-4" /> Download
          </button>
          <button onClick={onDelete} className="btn-secondary text-red-600 hover:text-red-700">
            <Trash2 className="w-4 h-4" /> Delete
          </button>
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </div>
    </div>
  );
}
