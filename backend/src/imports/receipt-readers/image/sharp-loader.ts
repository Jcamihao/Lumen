import type { Sharp } from 'sharp';
import type SharpConstructor from 'sharp';

// O pacote sharp só traz tipos ESM (default); o require do CJS entrega o mesmo construtor.
export const sharp = require('sharp') as typeof SharpConstructor;
export type SharpPipeline = Sharp;
