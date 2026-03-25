import fs from 'fs';
import path from 'path';

export async function extractTextFromFile(
  filePath: string,
  mimeType: string,
  originalName: string
): Promise<string> {
  const ext = path.extname(originalName).toLowerCase();

  // Plain text files
  if (
    mimeType.startsWith('text/') ||
    ['.txt', '.csv', '.md', '.json'].includes(ext)
  ) {
    return fs.readFileSync(filePath, 'utf-8').slice(0, 50000);
  }

  // PDF
  if (mimeType === 'application/pdf' || ext === '.pdf') {
    try {
      const pdfParse = require('pdf-parse');
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdfParse(dataBuffer);
      return (data.text || '').slice(0, 50000);
    } catch (err) {
      console.error('PDF parse error:', err);
      return `[PDF file: ${originalName} - text extraction failed]`;
    }
  }

  // Images - return a placeholder for Claude Vision (we'll send the file directly)
  if (mimeType.startsWith('image/')) {
    return `[Image file: ${originalName}]`;
  }

  // Fallback
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.slice(0, 50000);
  } catch {
    return `[Binary file: ${originalName} - cannot extract text]`;
  }
}

export async function extractTextFromImage(filePath: string): Promise<string> {
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

    const imageData = fs.readFileSync(filePath);
    const base64 = imageData.toString('base64');
    const mimeType = filePath.match(/\.(jpg|jpeg)$/i)
      ? 'image/jpeg'
      : filePath.match(/\.png$/i)
      ? 'image/png'
      : filePath.match(/\.gif$/i)
      ? 'image/gif'
      : 'image/webp';

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mimeType, data: base64 },
            },
            {
              type: 'text',
              text: 'Please transcribe all text visible in this image. Include all text exactly as shown. If this is a screenshot of a conversation, include all messages. If it is a document, transcribe the full content.',
            },
          ],
        },
      ],
    });

    const content = response.content[0];
    return content.type === 'text' ? content.text : '[Image: could not extract text]';
  } catch (err) {
    console.error('Image text extraction error:', err);
    return '[Image: text extraction failed]';
  }
}
