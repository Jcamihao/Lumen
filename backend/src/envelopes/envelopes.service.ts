import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Envelope, Prisma, TransactionType } from '@prisma/client';
import { EntitlementsService } from '../billing/entitlements.service';
import { LifeEngineService } from '../life-engine/life-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEnvelopeDto } from './dto/create-envelope.dto';
import { UpdateEnvelopeDto } from './dto/update-envelope.dto';
import { monthsBetween, monthStart } from './envelope.util';
import { EnvelopeMonthChangedError, EnvelopeWriteReceipt, EnvelopeWriteUncertainError } from './conversation-write.types';

/** Meses seguidos sem abrir o app que ainda geram deposito numa unica leitura. */
export const MAX_TOPUP_CATCH_UP = 36;

@Injectable()
export class EnvelopesService {
  private readonly logger = new Logger(EnvelopesService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifeEngineService: LifeEngineService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async list(userId: string, now = new Date()) {
    const envelopes = await this.prisma.envelope.findMany({
      where: { userId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });

    // So gera deposito de quem ainda esta ativo; um envelope pausado fica
    // congelado no saldo que tinha.
    await Promise.all(
      envelopes.filter((envelope) => envelope.isActive).map((envelope) => this.ensureTopUps(envelope, now)),
    );

    return Promise.all(envelopes.map((envelope) => this.toResponse(envelope, now)));
  }

  async create(userId: string, dto: CreateEnvelopeDto) {
    const { envelope, now } = await this.persistEnvelope(userId, dto);
    await this.refreshAfterCreate(userId);
    return this.toResponse(envelope, now);
  }

  async createForConversation(
    userId: string,
    dto: CreateEnvelopeDto,
    expectedProvisionMonth: string,
  ): Promise<EnvelopeWriteReceipt> {
    const { envelope, now } = await this.persistEnvelope(userId, dto, expectedProvisionMonth);
    const refreshPending = await this.refreshAfterCreate(userId);
    return {
      id: envelope.id,
      name: envelope.name,
      monthlyCents: Math.round(Number(envelope.monthlyAmount) * 100),
      provisionMonth: monthStart(now).toISOString().slice(0, 10),
      refreshPending,
    };
  }

  /** Núcleo compartilhado com a tela: envelope e provisão inicial tornam-se visíveis juntos. */
  private async persistEnvelope(userId: string, dto: CreateEnvelopeDto, expectedMonth?: string) {
    const name = typeof dto.name === 'string' ? dto.name.trim() : '';
    if (Array.from(name).length < 2 || Array.from(name).length > 60 || typeof dto.color !== 'string') {
      throw new BadRequestException('Informe um nome de reserva de 2 a 60 caracteres e uma cor.');
    }
    if (!Number.isFinite(dto.monthlyAmount) || dto.monthlyAmount < 0.01 ||
      dto.monthlyAmount > 9_999_999_999 || new Prisma.Decimal(dto.monthlyAmount).decimalPlaces() > 2) {
      throw new BadRequestException('Informe um valor mensal positivo com até duas casas decimais.');
    }
    await this.entitlements.assertCanCreate(userId, 'envelopes');
    let callbackFinished = false;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const month = monthStart(now);
        if (expectedMonth !== undefined && month.toISOString().slice(0, 10) !== expectedMonth) {
          throw new EnvelopeMonthChangedError(month.toISOString().slice(0, 10));
        }
        const envelope = await tx.envelope.create({
          data: { userId, name, color: dto.color, icon: dto.icon, monthlyAmount: new Prisma.Decimal(dto.monthlyAmount) },
        }).catch((error) => { throw this.friendlyDuplicateNameError(error); });
        await tx.envelopeTopUp.create({
          data: { envelopeId: envelope.id, month, amount: envelope.monthlyAmount },
        });
        callbackFinished = true;
        return { envelope, now };
      });
    } catch (error) {
      if (callbackFinished) throw new EnvelopeWriteUncertainError();
      throw error;
    }
  }

  private async refreshAfterCreate(userId: string): Promise<boolean> {
    try {
      await this.lifeEngineService.touchUserData(userId);
      return false;
    } catch (error) {
      this.logger.warn({ operation: 'create.refresh', errorName: error instanceof Error ? error.name : 'Unknown' });
      return true;
    }
  }

  async update(userId: string, id: string, dto: UpdateEnvelopeDto) {
    const existing = await this.ensureOwnership(userId, id);

    // Reativar uma reserva pausada ocupa vaga do plano.
    if (dto.isActive === true && !existing.isActive) {
      await this.entitlements.assertCanCreate(userId, 'envelopes');
    }

    const data: Prisma.EnvelopeUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.icon !== undefined) data.icon = dto.icon;
    if (dto.monthlyAmount !== undefined) data.monthlyAmount = new Prisma.Decimal(dto.monthlyAmount);
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const envelope = await this.prisma.envelope
      .update({ where: { id }, data })
      .catch((error) => {
        throw this.friendlyDuplicateNameError(error);
      });

    if (envelope.isActive) {
      await this.ensureTopUps(envelope, new Date());
    }

    await this.lifeEngineService.touchUserData(userId);
    return this.toResponse(envelope, new Date());
  }

  async remove(userId: string, id: string) {
    await this.ensureOwnership(userId, id);
    // As transacoes ja marcadas com este envelope ficam (SetNull no schema);
    // so o "cofre" em si deixa de existir.
    await this.prisma.envelope.delete({ where: { id } });
    await this.lifeEngineService.touchUserData(userId);

    return { success: true };
  }

  /**
   * Cria os depositos que faltam entre o ultimo registrado (ou a criacao do
   * envelope) e o mes de `now`, usando o monthlyAmount vigente em cada
   * chamada — depositos ja criados ficam congelados (mudar o valor so afeta
   * os proximos). Idempotente: rodar de novo no mesmo mes nao duplica.
   */
  private async ensureTopUps(envelope: Envelope, now: Date) {
    const latest = await this.prisma.envelopeTopUp.findFirst({
      where: { envelopeId: envelope.id },
      orderBy: { month: 'desc' },
    });

    const from = latest ? new Date(latest.month.getTime() + 1) : envelope.createdAt;
    const months = monthsBetween(from, now).slice(0, MAX_TOPUP_CATCH_UP);

    for (const month of months) {
      // create (nao upsert): um deposito ja existente nunca e sobrescrito.
      await this.prisma.envelopeTopUp
        .create({ data: { envelopeId: envelope.id, month, amount: envelope.monthlyAmount } })
        .catch((error) => {
          // Duas chamadas concorrentes podem tentar criar o mesmo mes; a
          // segunda perde a corrida e tudo bem, o deposito ja existe.
          if ((error as { code?: string } | null)?.code !== 'P2002') {
            throw error;
          }
        });
    }
  }

  private async toResponse(envelope: Envelope, now: Date) {
    const [topUpAggregate, spentAggregate] = await Promise.all([
      this.prisma.envelopeTopUp.aggregate({
        where: { envelopeId: envelope.id, month: { lte: monthStart(now) } },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { envelopeId: envelope.id, type: TransactionType.EXPENSE },
        _sum: { amount: true },
      }),
    ]);

    const deposited = Number(topUpAggregate._sum.amount ?? 0);
    const spent = Number(spentAggregate._sum.amount ?? 0);

    return {
      id: envelope.id,
      name: envelope.name,
      color: envelope.color,
      icon: envelope.icon,
      monthlyAmount: Number(envelope.monthlyAmount),
      isActive: envelope.isActive,
      deposited,
      spent,
      available: deposited - spent,
    };
  }

  /** Indice unico (userId, name): mensagem legivel em vez do 500 cru do Prisma. */
  private friendlyDuplicateNameError(error: unknown) {
    if ((error as { code?: string } | null)?.code === 'P2002') {
      return new BadRequestException('Você já tem um envelope com este nome.');
    }

    return error;
  }

  private async ensureOwnership(userId: string, id: string) {
    const envelope = await this.prisma.envelope.findFirst({ where: { id, userId } });

    if (!envelope) {
      throw new NotFoundException('Envelope nao encontrado.');
    }

    return envelope;
  }
}
