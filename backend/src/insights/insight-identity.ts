import { createHash } from 'node:crypto';
import { InsightType } from '@prisma/client';
import { GeneratedInsight } from './insight.types';

/**
 * Cada tipo de insight fala por uma persona propria, para que a leitura tenha
 * voz e nao seja um bloco unico de texto. Trocar um nome aqui muda a voz em
 * todo lugar que consome o insight (dashboard e Selah).
 */
const INSIGHT_PERSONAS: Record<InsightType, { name: string; role: string }> = {
  [InsightType.PRODUCTIVITY]: { name: 'Norte', role: 'aponta o que destrava o seu dia' },
  [InsightType.FINANCE]: { name: 'Lastro', role: 'cuida do que sustenta o seu mes' },
  [InsightType.GOAL]: { name: 'Horizonte', role: 'acompanha o que voce quer alcancar' },
  [InsightType.ROUTINE]: { name: 'Compasso', role: 'observa o ritmo da sua rotina' },
};

/** Carimba a persona do tipo no metadata, sem exigir nada de cada detector. */
export function withPersona(insight: GeneratedInsight): GeneratedInsight {
  return {
    ...insight,
    metadata: { ...(insight.metadata ?? {}), persona: INSIGHT_PERSONAS[insight.type] },
  };
}

/**
 * Identidade estavel da situacao: tipo, regra e severidade.
 * A severidade entra de proposito — quando um alerta escala de WARNING para
 * CRITICAL a situacao mudou de fato e merece ser avisada de novo.
 */
export function fingerprintOf(insight: GeneratedInsight): string {
  return `${insight.type}:${insight.key}:${insight.severity}`;
}

/** Resumo curto e estavel de um assunto, para compor a chave da regra. */
export function hashSubject(parts: string[]): string {
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
}
