import { IsUUID } from "class-validator";

export class RequestEmailMfaBypassDto {
  @IsUUID()
  challengeId!: string;
}
