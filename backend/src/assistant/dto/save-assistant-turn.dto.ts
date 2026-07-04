import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class SaveAssistantTurnDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  question!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  answer!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  focusArea?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  source?: string;
}
