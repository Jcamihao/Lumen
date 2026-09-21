declare module "qrcode" {
  type QrOptions = {
    width?: number;
    margin?: number;
    /** L, M, Q ou H: quanto do codigo pode estar danificado e ainda ser lido. */
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    color?: { dark?: string; light?: string };
  };

  export function toDataURL(text: string, options?: QrOptions): Promise<string>;

  /** No build de navegador so o formato SVG e suportado. */
  export function toString(
    text: string,
    options?: QrOptions & { type: "svg" },
  ): Promise<string>;
}
