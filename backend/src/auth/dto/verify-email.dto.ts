import { IsString, IsUUID, MinLength } from "class-validator";

export class VerifyEmailDto {
  @IsUUID()
  id!: string;

  @IsString()
  @MinLength(20)
  token!: string;
}
