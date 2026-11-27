import { BadRequestException } from '@nestjs/common';
import { RECEIPT_MAX_PIXELS } from '../receipt-readers/image/receipt-image.limits';
import { sharp } from '../receipt-readers/image/sharp-loader';
import { IMAGE_TOO_LARGE_MESSAGE, OPEN_IMAGE_MESSAGE } from './extraction-messages';

// Limite padrão do próprio sharp, usado só para ler o cabeçalho antes da checagem de megapixels.
const SHARP_HEADER_PIXEL_LIMIT = 268_402_689;

/** Recusa imagem que não abre ou que tem pixels demais. */
export async function ensureReadableImage(buffer: Buffer) {
  const { width, height } = await readImageSize(buffer);
  // Checagem antes de decodificar: uma imagem enorme não chega a ocupar memória.
  if (width * height > RECEIPT_MAX_PIXELS) {
    throw new BadRequestException(IMAGE_TOO_LARGE_MESSAGE);
  }
}

async function readImageSize(buffer: Buffer): Promise<{ width: number; height: number }> {
  let width: number;
  let height: number;
  try {
    const metadata = await sharp(buffer, {
      limitInputPixels: SHARP_HEADER_PIXEL_LIMIT,
    }).metadata();
    width = metadata.width ?? 0;
    height = metadata.height ?? 0;
  } catch {
    throw new BadRequestException(OPEN_IMAGE_MESSAGE);
  }

  if (width <= 0 || height <= 0) {
    throw new BadRequestException(OPEN_IMAGE_MESSAGE);
  }
  return { width, height };
}
