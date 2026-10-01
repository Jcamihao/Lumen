import { PartialType } from '@nestjs/swagger';
import { CreateFinanceCategoryDto } from './create-finance-category.dto';

export class UpdateFinanceCategoryDto extends PartialType(CreateFinanceCategoryDto) {}
