import crypto from 'node:crypto';
import { put } from '@vercel/blob';

export class StorageConfigError extends Error {
  code = 'STORAGE_NOT_CONFIGURED';
  status = 503;
  constructor(message: string) {
    super(message);
    this.name = 'StorageConfigError';
  }
}

function detectImageFormat(buf: Buffer): { ext: 'jpg' | 'png' | 'webp'; mimeType: string } | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', mimeType: 'image/jpeg' };
  }
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { ext: 'png', mimeType: 'image/png' };
  }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { ext: 'webp', mimeType: 'image/webp' };
  }
  return null;
}

export async function saveUploadedImage(
  dataUrlOrBase64: string,
  savePostgresFallback?: (id: string, mimeType: string, dataBase64: string) => Promise<void>,
  maxBytes = 5 * 1024 * 1024
): Promise<{ url: string; sizeBytes: number }> {
  const match = dataUrlOrBase64.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (dataUrlOrBase64.startsWith('data:') && !match) {
    throw new Error('Only base64-encoded JPEG, PNG, and WebP data URLs are accepted.');
  }
  const rawBase64 = match ? match[2] : dataUrlOrBase64;
  if (rawBase64.length === 0 || rawBase64.length > Math.ceil(maxBytes * 1.45)) {
    throw new Error('Image must be non-empty and at most 5 MB.');
  }
  const buf = Buffer.from(rawBase64, 'base64');

  if (buf.length === 0 || buf.length > maxBytes) {
    throw new Error('Image must be non-empty and at most 5 MB.');
  }

  const fmt = detectImageFormat(buf);
  if (!fmt) {
    throw new Error('Only valid JPEG, PNG, and WebP images are accepted.');
  }

  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${fmt.ext}`;
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim();

  if (blobToken) {
    const blob = await put(`strangetheory/${filename}`, buf, {
      access: 'public',
      contentType: fmt.mimeType,
      token: blobToken,
    });
    return { url: blob.url, sizeBytes: buf.length };
  }

  if (process.env.NODE_ENV === 'production') {
    throw new StorageConfigError(
      'Image storage is not configured for production (missing BLOB_READ_WRITE_TOKEN).'
    );
  }

  if (!savePostgresFallback) {
    throw new StorageConfigError('No development fallback asset store provided.');
  }

  await savePostgresFallback(filename, fmt.mimeType, buf.toString('base64'));
  return { url: `/api/assets/${filename}`, sizeBytes: buf.length };
}
