import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CommitReceiptImportItemDto {
  @IsString()
  @MaxLength(200)
  description!: string;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number | null;

  @IsNumber()
  @Min(0)
  totalPrice!: number;
}

export class CommitReceiptImportDto {
  @IsString()
  receiptScanId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  merchantName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  description?: string;

  @IsOptional()
  @IsString()
  purchaseDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  totalAmount?: number;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CommitReceiptImportItemDto)
  items?: CommitReceiptImportItemDto[];
}
