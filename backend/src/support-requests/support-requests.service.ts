import { Injectable } from '@nestjs/common';
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
