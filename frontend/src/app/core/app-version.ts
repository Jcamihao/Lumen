import packageJson from '../../../package.json';

/** Versao do app (a mesma do package.json, que sobe a cada commit). Vai junto com feedback e bug report. */
export const APP_VERSION: string = packageJson.version;
