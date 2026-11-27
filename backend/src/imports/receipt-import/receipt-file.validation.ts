import { BadRequestException } from '@nestjs/common';
import { sniffMime } from '../../common/utils/file-sniff';
import { RECEIPT_IMAGE_MAX_BYTES, RECEIPT_PDF_MAX_BYTES } from '../imports.constants';

export function ensureReceiptFile(file?: Express.Multer.File): void {
  if (!file) {
    throw new BadRequestException('Envie uma imagem ou PDF da nota fiscal no campo file.');
  }
  // O tipo vem dos bytes do arquivo, nao do mimetype que o cliente declarou.
  const kind = sniffMime(file.buffer);
  if (!kind) {
    throw new BadRequestException(
      'Formato invalido. Envie uma imagem (JPG, PNG, WEBP) ou um arquivo PDF da nota fiscal.',
    );
  }
  const isPdf = kind === 'application/pdf';
  const maxSizeBytes = isPdf ? RECEIPT_PDF_MAX_BYTES : RECEIPT_IMAGE_MAX_BYTES;
  const maxLabel = isPdf ? '10 MB' : '8 MB';
  if (file.size > maxSizeBytes) {
    throw new BadRequestException(`O arquivo da nota deve ter no maximo ${maxLabel}.`);
  }
}
