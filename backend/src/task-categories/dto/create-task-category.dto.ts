import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateTaskCategoryDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  color!: string;

  @IsOptional()
  @IsString()
  icon?: string;
}
