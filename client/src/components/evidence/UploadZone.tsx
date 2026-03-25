import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Loader2, FileText, Image, File } from 'lucide-react';

interface Props {
  onUpload: (files: File[]) => void;
  uploading: boolean;
}

function FileIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith('image/')) return <Image className="w-4 h-4 text-blue-500" />;
  if (mimeType === 'application/pdf') return <FileText className="w-4 h-4 text-red-500" />;
  return <File className="w-4 h-4 text-slate-400" />;
}

export default function UploadZone({ onUpload, uploading }: Props) {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0 && !uploading) {
        onUpload(acceptedFiles);
      }
    },
    [onUpload, uploading]
  );

  const { getRootProps, getInputProps, isDragActive, acceptedFiles } = useDropzone({
    onDrop,
    disabled: uploading,
    accept: {
      'application/pdf': ['.pdf'],
      'text/plain': ['.txt'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/gif': ['.gif'],
      'image/webp': ['.webp'],
    },
    maxFiles: 20,
    maxSize: 25 * 1024 * 1024,
  });

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
          uploading
            ? 'border-slate-200 bg-slate-50 cursor-not-allowed'
            : isDragActive
            ? 'border-blue-400 bg-blue-50'
            : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50/50'
        }`}
      >
        <input {...getInputProps()} />
        {uploading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
            <div className="text-sm font-medium text-slate-700">Uploading and analyzing documents...</div>
            <div className="text-xs text-slate-400">This may take a moment. Each file is being classified by AI.</div>
          </div>
        ) : isDragActive ? (
          <div className="flex flex-col items-center gap-3">
            <Upload className="w-10 h-10 text-blue-500" />
            <div className="text-sm font-medium text-blue-600">Drop files here</div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center">
              <Upload className="w-7 h-7 text-slate-400" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-700 mb-1">
                Drop files here or click to browse
              </div>
              <div className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                Upload contracts, invoices, emails, screenshots, text conversations, or any relevant documents.
                The system will automatically classify and extract key information.
              </div>
            </div>
            <div className="text-xs text-slate-400">
              PDF, TXT, JPG, PNG, GIF, WEBP — up to 25MB each, 20 files max
            </div>
          </div>
        )}
      </div>

      {acceptedFiles.length > 0 && !uploading && (
        <div className="text-xs text-slate-500 flex items-center gap-1.5">
          <div className="flex items-center gap-1">
            {acceptedFiles.slice(0, 3).map((f) => (
              <span key={f.name} className="flex items-center gap-1 bg-slate-100 px-2 py-1 rounded">
                <FileIcon mimeType={f.type} />
                {f.name.length > 20 ? f.name.slice(0, 20) + '...' : f.name}
              </span>
            ))}
            {acceptedFiles.length > 3 && (
              <span className="text-slate-400">+{acceptedFiles.length - 3} more</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
