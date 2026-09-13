import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTagGroupDto } from './dto/create-tag-group.dto';
import { UpdateTagGroupDto } from './dto/update-tag-group.dto';

/**
 * Grupos que toda conta nova ja recebe pronta, pra nao comecar do zero na
 * primeira nota fiscal. O usuario pode renomear, trocar a cor ou apagar
 * qualquer um deles normalmente — sao so um ponto de partida, nao ficam
 * travados.
 */
export const DEFAULT_TAG_GROUPS: Array<{ name: string; color: string }> = [
  { name: 'Compras do mes', color: '#F4A261' },
  { name: 'Padaria', color: '#E76F51' },
  { name: 'Farmacia', color: '#2A9D8F' },
  { name: 'Restaurante', color: '#E9C46A' },
];

@Injectable()
export class TagGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.tagGroup.findMany({
      where: { userId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async create(userId: string, dto: CreateTagGroupDto) {
    const highestSortOrder = await this.prisma.tagGroup.aggregate({
      where: { userId },
      _max: { sortOrder: true },
    });

    return this.prisma.tagGroup.create({
      data: {
        userId,
        name: dto.name.trim(),
        color: dto.color,
        sortOrder: (highestSortOrder._max.sortOrder ?? -1) + 1,
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateTagGroupDto) {
    await this.ensureOwnership(userId, id);

    return this.prisma.tagGroup.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
      },
    });
  }

  async remove(userId: string, id: string) {
    await this.ensureOwnership(userId, id);
    // onDelete: SetNull na FK ja desvincula as notas fiscais deste grupo;
    // nao precisa de updateMany manual aqui.
    await this.prisma.tagGroup.delete({ where: { id } });

    return { success: true };
  }

  private async ensureOwnership(userId: string, id: string) {
    const tagGroup = await this.prisma.tagGroup.findFirst({
      where: { id, userId },
    });

    if (!tagGroup) {
      throw new NotFoundException('Grupo de tags nao encontrado.');
    }

    return tagGroup;
  }
}
