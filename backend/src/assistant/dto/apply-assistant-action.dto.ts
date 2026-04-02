import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ApplyAssistantActionDto {
  @IsString()
  @IsIn(['create_task', 'create_goal', 'create_reminder', 'open_module'])
  kind!: 'create_task' | 'create_goal' | 'create_reminder' | 'open_module';

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  route?: string;
}
