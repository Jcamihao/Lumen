export function normalizeCode(code: string) {
  return code.replace(/[^A-Z0-9]/gi, "").toUpperCase();
}
