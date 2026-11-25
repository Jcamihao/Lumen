import {
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { IsAvatarDataUrl } from "../../common/validators/avatar-data-url.validator";

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  // 2 MB de imagem (limite do front) vira ~2,8M caracteres em base64.
  @MaxLength(3000000)
  @IsAvatarDataUrl()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  @Matches(/^$|^[0-9()+\-.\s]{8,20}$/, {
    message: "Informe um telefone valido.",
  })
  phone?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  occupation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  primaryGoal?: string;

  @IsOptional()
  @IsString()
  preferredCurrency?: string;

  @IsOptional()
  @IsNumber()
  monthlyIncome?: number;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsBoolean()
  privacyNoticeAccepted?: boolean;

  @IsOptional()
  @IsBoolean()
  aiAssistantEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  emailWeeklyDigest?: boolean;

  @IsOptional()
  @IsBoolean()
  emailReminders?: boolean;

  @IsOptional()
  @IsBoolean()
  emailInsightAlerts?: boolean;

  @IsOptional()
  @IsBoolean()
  emailBillReminders?: boolean;
}
