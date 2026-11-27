import { RECEIPT_MAX_PIXELS } from '../image/receipt-image.limits';
import { sharp } from '../image/sharp-loader';

type JsQrOptions = {
  inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst';
};
type JsQrFn = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: JsQrOptions,
) => { data: string } | null;
// jsqr não tem tipos embutidos na versão usada; o tipo mínimo acima cobre só o que lemos.
const jsQR = require('jsqr') as JsQrFn;

const QR_WIDTHS: Array<number | null> = [null, 900, 1400, 600];

/**
 * Procura um QR code na imagem PNG. Tenta a largura original e três redimensionamentos,
 * mas nunca começa uma tentativa depois de `deadlineMs` ms desde o início.
 * Não lança: erro de imagem vira `null` (sem QR legível).
 */
export async function decodeQr(png: Buffer, deadlineMs = 800): Promise<string | null> {
  const start = Date.now();

  for (const width of QR_WIDTHS) {
    if (Date.now() - start >= deadlineMs) {
      return null;
    }

    try {
      const code = await scanQrAtWidth(png, width);
      if (code) {
        return code.data;
      }
    } catch {
      return null;
    }
  }

  return null;
}

async function scanQrAtWidth(png: Buffer, width: number | null) {
  let pipeline = sharp(png, { limitInputPixels: RECEIPT_MAX_PIXELS }).flatten({
    background: '#ffffff',
  });
  if (width) {
    pipeline = pipeline.resize({ width });
  }

  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height, {
    inversionAttempts: 'attemptBoth',
  });
}
