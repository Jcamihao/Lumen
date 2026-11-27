import { BadRequestException } from '@nestjs/common';
import { RECEIPT_MAX_PIXELS } from '../receipt-readers/image/receipt-image.limits';
import { sharp, SharpPipeline } from '../receipt-readers/image/sharp-loader';
import { OPEN_IMAGE_MESSAGE } from './extraction-messages';

/** Foto de celular vem deitada: .rotate() sem argumento aplica a orientação do EXIF. */
export function rotateToPng(source: Buffer): Promise<Buffer> {
  return toPng(source, (pipeline) => pipeline.rotate());
}

export function prepareForSecondPass(rotated: Buffer): Promise<Buffer> {
  return toPng(rotated, (pipeline) =>
    pipeline
      .flatten({ background: '#ffffff' })
      .greyscale()
      .normalise()
      .resize({ width: 1400 })
      .sharpen(),
  );
}

async function toPng(
  source: Buffer,
  adjust: (pipeline: SharpPipeline) => SharpPipeline,
): Promise<Buffer> {
  try {
    return await adjust(sharp(source, { limitInputPixels: RECEIPT_MAX_PIXELS }))
      .png()
      .toBuffer();
  } catch {
    throw new BadRequestException(OPEN_IMAGE_MESSAGE);
  }
}
