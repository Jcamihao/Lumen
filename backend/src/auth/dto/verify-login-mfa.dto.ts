import { IsString, IsUUID, MaxLength, MinLength } from "class-validator";

export class VerifyLoginMfaDto {
  @IsUUID()
  challengeId!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(32)
  code!: string;
}
