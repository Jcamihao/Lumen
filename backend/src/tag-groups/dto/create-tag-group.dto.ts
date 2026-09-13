import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateTagGroupDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'color deve ser um hex no formato #RRGGBB.' })
  color?: string;
}
