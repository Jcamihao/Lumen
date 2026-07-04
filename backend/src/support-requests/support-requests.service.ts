import { Injectable, NotFoundException } from '@nestjs/common';
import { SupportRequestStatus } from '@prisma/client';
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

  listAll(filters?: { status?: SupportRequestStatus; page?: number }) {
    const page = Math.max((filters?.page ?? 1) - 1, 0);
    const take = 30;

    return this.prisma.supportRequest.findMany({
      where: {
        status: filters?.status,
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
      },
    });
  }
}
