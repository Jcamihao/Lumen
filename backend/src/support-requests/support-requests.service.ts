import { Injectable, NotFoundException } from '@nestjs/common';
import { SupportRequestStatus, SupportRequestType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupportRequestDto } from './dto/create-support-request.dto';

@Injectable()
export class SupportRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.supportRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  }

  listAll(filters?: {
    status?: SupportRequestStatus;
    type?: SupportRequestType;
    page?: number;
  }) {
    const page = Math.max((filters?.page ?? 1) - 1, 0);
    const take = 30;

    return this.prisma.supportRequest.findMany({
      where: {
        status: filters?.status,
        type: filters?.type,
      },
      orderBy: { createdAt: 'desc' },
      skip: page * take,
      take,
      select: {
        id: true,
        type: true,
        status: true,
        severity: true,
        subject: true,
        message: true,
        emailSnapshot: true,
        screenPath: true,
        appVersion: true,
        rating: true,
        area: true,
        canContact: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });
  }

  async updateStatus(id: string, status: SupportRequestStatus) {
    const existing = await this.prisma.supportRequest.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException('Solicitacao de suporte nao encontrada.');
    }

    return this.prisma.supportRequest.update({
      where: { id },
      data: { status },
      select: { id: true, status: true, updatedAt: true },
    });
  }

  create(
    userId: string,
    userEmail: string,
    dto: CreateSupportRequestDto,
  ) {
    return this.prisma.supportRequest.create({
      data: {
        userId,
        type: dto.type,
        severity: dto.severity,
        subject: dto.subject,
        message: dto.message,
        emailSnapshot: userEmail,
        screenPath: dto.screenPath,
        appVersion: dto.appVersion,
        deviceInfo: dto.deviceInfo,
        rating: dto.rating,
        area: dto.area,
        canContact: dto.canContact ?? false,
      },
    });
  }

  /**
   * Retrato do feedback dos testadores para o painel: quantos, nota media,
   * distribuicao das notas e as areas mais citadas. So conta pedidos com nota
   * (a pagina de feedback); bugs e duvidas do suporte ficam de fora.
   */
  async feedbackSummary() {
    const where = { type: SupportRequestType.FEEDBACK, rating: { not: null } };

    const [totals, byRating, byArea] = await Promise.all([
      this.prisma.supportRequest.aggregate({
        where,
        _count: { _all: true },
        _avg: { rating: true },
      }),
      this.prisma.supportRequest.groupBy({
        by: ['rating'],
        where,
        _count: { _all: true },
      }),
      this.prisma.supportRequest.groupBy({
        by: ['area'],
        where,
        _count: { _all: true },
        _avg: { rating: true },
      }),
    ]);

    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const row of byRating) {
      if (row.rating) distribution[row.rating] = row._count._all;
    }

    return {
      total: totals._count._all,
      averageRating:
        totals._avg.rating === null ? null : Math.round(totals._avg.rating * 10) / 10,
      distribution,
      byArea: byArea
        .map((row) => ({
          area: row.area ?? 'GENERAL',
          count: row._count._all,
          averageRating:
            row._avg.rating === null ? null : Math.round(row._avg.rating * 10) / 10,
        }))
        .sort((a, b) => b.count - a.count),
    };
  }
}
