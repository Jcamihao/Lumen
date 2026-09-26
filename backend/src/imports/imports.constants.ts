// nginx da API limita o corpo a 10 MB (client_max_body_size): limites maiores aqui seriam inalcancaveis.
export const CSV_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const CSV_IMPORT_MAX_ROWS = 5000;
export const RECEIPT_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const RECEIPT_PDF_MAX_BYTES = 10 * 1024 * 1024;
