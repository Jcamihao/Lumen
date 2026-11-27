import { Injectable } from '@nestjs/common';
import { InsightSeverity, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { loadInsightContext } from './context/load-insight-context';
import { generateInsights } from './detectors/generate-insights';
import { fingerprintOf } from './insight-identity';
import { GeneratedInsight } from './insight.types';

const LIST_LIMIT = 8;

@Injectable()
export class InsightsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const existingInsights = await this.findLatest(userId);
    if (existingInsights.length > 0) return existingInsights;
    return this.refreshForUser(userId);
  }

  /**
   * Reconcilia os insights do usuario com a situacao atual.
   *
   * Faz upsert por fingerprint em vez de apagar e recriar tudo: enquanto a
   * situacao persistir, a linha sobrevive e com ela o notifiedAt — que e o
   * que impede o worker de notificar o mesmo alerta a cada ciclo da fila.
   * Fingerprints que sumiram da geracao sao podados, entao uma situacao que
   * se resolve e volta depois e tratada como nova (e avisa de novo).
   */
  async refreshForUser(userId: string) {
    const context = await loadInsightContext(this.prisma, userId);
    const generated = generateInsights(context);
    const fingerprints = generated.map(fingerprintOf);

    await this.prisma.$transaction([
      this.prisma.insight.deleteMany({ where: { userId, fingerprint: { notIn: fingerprints } } }),
      ...generated.map((insight) => this.upsertInsight(userId, insight)),
    ]);
    return this.findLatest(userId);
  }

  /**
   * Devolve os insights que ainda merecem notificacao e ja os marca como
   * avisados, para que uma segunda passada da fila nao repita o alerta.
   */
  async takePendingNotifications(userId: string, severities: InsightSeverity[] = [InsightSeverity.CRITICAL]) {
    const pending = await this.prisma.insight.findMany({
      where: { userId, notifiedAt: null, severity: { in: severities } },
      orderBy: { createdAt: 'asc' },
    });
    if (pending.length === 0) return [];

    await this.prisma.insight.updateMany({
      where: { id: { in: pending.map((insight) => insight.id) } },
      data: { notifiedAt: new Date() },
    });
    return pending;
  }

  private findLatest(userId: string) {
    return this.prisma.insight.findMany({
      where: { userId },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: LIST_LIMIT,
    });
  }

  private upsertInsight(userId: string, insight: GeneratedInsight) {
    const fingerprint = fingerprintOf(insight);
    const content = {
      type: insight.type,
      severity: insight.severity,
      message: insight.message,
      metadata: insight.metadata as Prisma.InputJsonValue | undefined,
    };
    return this.prisma.insight.upsert({
      where: { userId_fingerprint: { userId, fingerprint } },
      create: { userId, fingerprint, ...content },
      update: content,
    });
  }
}
