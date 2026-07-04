import { IsString, IsUUID, Length } from "class-validator";

export class VerifyEmailMfaBypassDto {
  @IsUUID()
  bypassChallengeId!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}
