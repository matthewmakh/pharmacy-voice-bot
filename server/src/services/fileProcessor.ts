/**
 * Text extraction for uploaded evidence.
 *
 * Coverage (previously: plain text, text-layer PDFs, and images only):
 *  - Plain text / CSV / md / json  → decoded directly
 *  - Word .docx                    → mammoth (was accepted by the uploader but never
 *                                    parsed — it fell through to a binary read and fed
 *                                    the model mojibake)
 *  - PDF with a text layer         → pdf-parse
 *  - Scanned / image-only PDF      → Claude reads the PDF natively (was silently empty)
 *  - Images                        → Claude vision transcription
 *
 * Operates on Buffers so it is agnostic to where the bytes came from (local disk or S3).
 */

import { anthropic, MODEL } from '../lib/anthropic';

const MAX_CHARS = 50_000;
/** Below this much extracted text, a PDF is treated as scanned and sent to Claude. */
const SCANNED_PDF_THRESHOLD = 80;

function isWordDocx(mimeType: string, name: string): boolean {
  return (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.toLowerCase().endsWith('.docx')
  );
}

export async function extractText(buffer: Buffer, mimeType: string, originalName: string): Promise<string> {
  const ext = originalName.toLowerCase().slice(originalName.lastIndexOf('.'));

  // Plain text family
  if (mimeType.startsWith('text/') || ['.txt', '.csv', '.md', '.json'].includes(ext)) {
    return buffer.toString('utf-8').slice(0, MAX_CHARS);
  }

  // Word .docx
  if (isWordDocx(mimeType, originalName)) {
    try {
      const mammoth = require('mammoth');
      const { value } = await mammoth.extractRawText({ buffer });
      const text = (value || '').trim();
      return text ? text.slice(0, MAX_CHARS) : `[Word document ${originalName}: no extractable text]`;
    } catch (err) {
      console.error('docx parse error:', err);
      return `[Word document ${originalName}: text extraction failed]`;
    }
  }

  // Legacy binary .doc — mammoth cannot read these.
  if (mimeType === 'application/msword' || ext === '.doc') {
    return `[Legacy .doc file ${originalName} — please re-upload as .docx or PDF for analysis]`;
  }

  // PDF
  if (mimeType === 'application/pdf' || ext === '.pdf') {
    let text = '';
    try {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      text = (data.text || '').trim();
    } catch (err) {
      console.error('PDF parse error:', err);
    }
    if (text.length >= SCANNED_PDF_THRESHOLD) return text.slice(0, MAX_CHARS);
    // Little or no text layer → likely scanned. Let Claude read the PDF directly.
    const viaClaude = await pdfViaClaude(buffer, originalName);
    return viaClaude || (text || `[PDF ${originalName}: no extractable text]`);
  }

  // Images
  if (mimeType.startsWith('image/')) {
    return imageViaClaude(buffer, mimeType);
  }

  // Unknown binary
  return `[File ${originalName}: unsupported type ${mimeType} — cannot extract text]`;
}

/** Send a scanned/image-only PDF to Claude for transcription. */
async function pdfViaClaude(buffer: Buffer, originalName: string): Promise<string | null> {
  try {
    const content: any = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } },
      { type: 'text', text: 'Transcribe all text content of this document exactly as written. Preserve headings, parties, dates, dollar amounts, and signatures. Output only the transcribed text.' },
    ];
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content }],
    });
    const block = resp.content[0];
    return block && block.type === 'text' ? block.text.slice(0, MAX_CHARS) : null;
  } catch (err) {
    console.error(`Claude PDF transcription failed for ${originalName}:`, err);
    return null;
  }
}

/** Transcribe an image with Claude vision. */
async function imageViaClaude(buffer: Buffer, mimeType: string): Promise<string> {
  try {
    const mediaType = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mimeType) ? mimeType : 'image/png';
    const content: any = [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: buffer.toString('base64') } },
      { type: 'text', text: 'Transcribe all text visible in this image exactly as shown. If it is a screenshot of a conversation, include every message with its sender. If it is a document, transcribe the full content.' },
    ];
    const resp = await anthropic.messages.create({ model: MODEL, max_tokens: 2048, messages: [{ role: 'user', content }] });
    const block = resp.content[0];
    return block && block.type === 'text' ? block.text.slice(0, MAX_CHARS) : '[Image: could not extract text]';
  } catch (err) {
    console.error('Image text extraction error:', err);
    return '[Image: text extraction failed]';
  }
}
