export type SniffedMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/gif'
  | 'image/heic'
  | 'application/pdf';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']);

/**
 * Identifica o tipo pelos primeiros bytes. O mimetype que o cliente declara e so uma
 * string enviada por ele: nao serve pra decidir o que o arquivo realmente e.
 */
export function sniffMime(buffer: Buffer): SniffedMime | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'image/png';
  }

  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }

  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) {
    return 'image/gif';
  }

  if (buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-') {
    return 'application/pdf';
  }

  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp' && HEIC_BRANDS.has(buffer.toString('ascii', 8, 12))) {
    return 'image/heic';
  }

  return null;
}

/** Texto puro (sem byte NUL nos primeiros KB): descarta binarios disfarcados de CSV. */
export function looksLikeText(buffer: Buffer, sampleBytes = 4096): boolean {
  return !buffer.subarray(0, sampleBytes).includes(0);
}
