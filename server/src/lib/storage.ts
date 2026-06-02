/**
 * Pluggable document storage.
 *
 * THE PROBLEM THIS SOLVES: the previous implementation wrote uploads to the local
 * container filesystem. On Railway (and most PaaS) that filesystem is ephemeral —
 * every redeploy or restart wipes it, silently destroying the evidence that every
 * case depends on, while the DB rows survive and point at files that no longer exist.
 *
 * THE FIX: all reads/writes go through a Storage interface. The `local` driver keeps
 * working for development. Setting STORAGE_DRIVER=s3 (with an S3 or Cloudflare R2
 * bucket) switches to durable object storage with zero code changes — the only
 * production-safe option. We persist an opaque storage *key*, never an absolute path.
 */

import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

export interface PutResult {
  key: string;
}

export interface Storage {
  /** Persist a file already staged on local disk (multer temp). Returns its storage key. */
  putFromPath(localPath: string, key: string, contentType: string): Promise<PutResult>;
  exists(key: string): Promise<boolean>;
  getBuffer(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Signed, time-limited URL when the driver supports it (S3/R2); null for local. */
  signedUrl(key: string, opts: { expiresInSeconds: number; downloadName?: string; inline?: boolean }): Promise<string | null>;
  readonly durable: boolean;
}

// ─── Local disk driver (development / single-box) ────────────────────────────────

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

class LocalStorage implements Storage {
  readonly durable = false;

  constructor() {
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }

  /** Keys are bare filenames; legacy rows may hold absolute paths, which we honor. */
  private resolve(key: string): string {
    return path.isAbsolute(key) ? key : path.join(UPLOAD_DIR, key);
  }

  async putFromPath(localPath: string, key: string): Promise<PutResult> {
    const dest = this.resolve(key);
    if (path.resolve(localPath) !== path.resolve(dest)) {
      await fs.promises.copyFile(localPath, dest);
      await fs.promises.unlink(localPath).catch(() => {});
    }
    return { key };
  }

  async exists(key: string): Promise<boolean> {
    return fs.promises.access(this.resolve(key)).then(() => true).catch(() => false);
  }

  async getBuffer(key: string): Promise<Buffer> {
    return fs.promises.readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await fs.promises.unlink(this.resolve(key)).catch(() => {});
  }

  async signedUrl(): Promise<string | null> {
    return null; // local files are streamed through the app, not signed
  }
}

// ─── S3 / Cloudflare R2 driver (production) ──────────────────────────────────────

class S3Storage implements Storage {
  readonly durable = true;
  private client: any;
  private bucket: string;
  private presign: (client: any, command: any, opts: { expiresIn: number }) => Promise<string>;
  private S3: any;

  constructor() {
    // Lazy-require so local-only deploys don't need the AWS SDK installed.
    const s3 = require('@aws-sdk/client-s3');
    const presigner = require('@aws-sdk/s3-request-presigner');
    this.S3 = s3;
    this.presign = presigner.getSignedUrl;
    this.bucket = process.env.S3_BUCKET as string;
    if (!this.bucket) throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET');
    this.client = new s3.S3Client({
      region: process.env.S3_REGION || 'auto',
      endpoint: process.env.S3_ENDPOINT, // set for Cloudflare R2 / MinIO; omit for AWS
      forcePathStyle: !!process.env.S3_ENDPOINT,
      credentials: process.env.S3_ACCESS_KEY_ID
        ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY as string }
        : undefined,
    });
  }

  async putFromPath(localPath: string, key: string, contentType: string): Promise<PutResult> {
    const body = await fs.promises.readFile(localPath);
    await this.client.send(new this.S3.PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
    await fs.promises.unlink(localPath).catch(() => {});
    return { key };
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new this.S3.HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async getBuffer(key: string): Promise<Buffer> {
    const out = await this.client.send(new this.S3.GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const chunks: Buffer[] = [];
    for await (const chunk of out.Body as Readable) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new this.S3.DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async signedUrl(key: string, opts: { expiresInSeconds: number; downloadName?: string; inline?: boolean }): Promise<string | null> {
    const disposition = opts.downloadName
      ? `${opts.inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(opts.downloadName)}"`
      : undefined;
    const command = new this.S3.GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentDisposition: disposition });
    return this.presign(this.client, command, { expiresIn: opts.expiresInSeconds });
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────────

function build(): Storage {
  const driver = (process.env.STORAGE_DRIVER || 'local').toLowerCase();
  if (driver === 's3' || driver === 'r2') return new S3Storage();
  return new LocalStorage();
}

export const storage: Storage = build();

/** Logged at boot so an operator running production on ephemeral disk is warned loudly. */
export function storageHealthWarning(): string | null {
  if (process.env.NODE_ENV === 'production' && !storage.durable) {
    return 'WARNING: using ephemeral local file storage in production. Uploaded documents WILL be lost on redeploy/restart. Set STORAGE_DRIVER=s3 with an S3/R2 bucket (S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, and S3_ENDPOINT for R2).';
  }
  return null;
}
