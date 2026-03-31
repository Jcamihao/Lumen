import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
  MinLength,
} from "class-validator";
import { AUTH_PASSWORD_MIN_LENGTH } from "../constants/password.constants";

export class RegisterDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(AUTH_PASSWORD_MIN_LENGTH)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4500000)
  avatarUrl?: string;

  @IsBoolean()
  privacyNoticeAccepted!: boolean;

  @IsOptional()
  @IsBoolean()
  aiAssistantEnabled?: boolean;

  @IsOptional()
  @IsString()
  preferredCurrency?: string;

  @IsOptional()
  @IsNumber()
  monthlyIncome?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  monthClosingDay?: number;

  @IsOptional()
  @IsString()
  timezone?: string;
}
