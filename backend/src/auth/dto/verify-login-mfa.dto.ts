import { IsString, IsUUID, MinLength } from "class-validator";

export class VerifyLoginMfaDto {
  @IsUUID()
  challengeId!: string;

  @IsString()
  @MinLength(6)
  code!: string;
}
