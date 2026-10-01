import { PartialType } from '@nestjs/swagger';
import { CreateTagGroupDto } from './create-tag-group.dto';

export class UpdateTagGroupDto extends PartialType(CreateTagGroupDto) {}
