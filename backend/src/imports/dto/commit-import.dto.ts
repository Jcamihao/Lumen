import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CommitImportDto {
  @IsString()
  importJobId!: string;

  @IsOptional()
  @IsBoolean()
  skipDuplicates?: boolean;
}
