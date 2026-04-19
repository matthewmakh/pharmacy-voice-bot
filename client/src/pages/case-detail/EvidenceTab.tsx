import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Loader2, Trash2, Eye, X } from 'lucide-react';
import {
  uploadDocuments,
  deleteDocument,
  getDocumentViewUrl,
} from '../../lib/api';
import { formatDate, formatFileSize, DOC_CLASSIFICATION_LABELS, DOC_CLASSIFICATION_TONES } from '../../lib/utils';
import type { Case } from '../../types';
import UploadZone from '../../components/evidence/UploadZone';
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';

export default function EvidenceTab({ caseData, onRefresh }: { caseData: Case; onRefresh: () => void }) {
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<typeof caseData.documents[number] | null>(null);

  const handleUpload = async (files: File[]) => {
    setUploading(true);
    try {
      await uploadDocuments(caseData.id, files);
      queryClient.invalidateQueries({ queryKey: ['case', caseData.id] });
      onRefresh();
    } finally {
      setUploading(false);
    }
  };

  const deleteMutation = useMutation({
    mutationFn: (docId: string) => deleteDocument(caseData.id, docId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseData.id] }),
  });

  return (
    <div className="space-y-6">
      <UploadZone onUpload={handleUpload} uploading={uploading} />

      {caseData.documents.length > 0 ? (
        <div className="card divide-y divide-slate-100">
          {caseData.documents.map((doc) => (
            <div key={doc.id} className="flex items-center gap-4 p-4">
              <FileText className="w-5 h-5 text-slate-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-800 truncate">{doc.originalName}</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {formatFileSize(doc.size)} · {formatDate(doc.uploadedAt)}
                </div>
              </div>
              {doc.classification === null ? (
                <Badge tone="neutral" icon={<Loader2 className="w-3 h-3 animate-spin" />}>Analyzing…</Badge>
              ) : (
                <Badge tone={DOC_CLASSIFICATION_TONES[doc.classification] ?? 'neutral'}>
                  {DOC_CLASSIFICATION_LABELS[doc.classification] ?? doc.classification}
                </Badge>
              )}
              <button
                onClick={() => setPreviewDoc(doc)}
                className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors"
                title="Preview"
              >
                <Eye className="w-4 h-4" />
              </button>
              <button
                onClick={() => deleteMutation.mutate(doc.id)}
                disabled={deleteMutation.isPending}
                className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"
                title="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setPreviewDoc(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col m-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="text-sm font-semibold text-slate-800 truncate">{previewDoc.originalName}</div>
              <button onClick={() => setPreviewDoc(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              {previewDoc.mimeType.startsWith('image/') ? (
                <img
                  src={getDocumentViewUrl(caseData.id, previewDoc.id)}
                  alt={previewDoc.originalName}
                  className="max-w-full mx-auto rounded-lg"
                />
              ) : previewDoc.mimeType === 'application/pdf' ? (
                <iframe
                  src={getDocumentViewUrl(caseData.id, previewDoc.id)}
                  className="w-full h-[70vh] rounded-lg border border-slate-200"
                  title={previewDoc.originalName}
                />
              ) : (
                <div className="text-sm text-slate-500 text-center py-12">
                  Preview not available for this file type. Use the download link to view.
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-100">
              <button
                onClick={() => {
                  deleteMutation.mutate(previewDoc.id);
                  setPreviewDoc(null);
                }}
                className="btn-secondary text-red-600 hover:text-red-700"
              >
                <Trash2 className="w-4 h-4" /> Delete
              </button>
              <button onClick={() => setPreviewDoc(null)} className="btn-secondary">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
