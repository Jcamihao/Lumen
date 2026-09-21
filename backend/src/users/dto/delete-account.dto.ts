import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";

export class DeleteAccountDto {
  @ApiProperty({ description: "Senha atual, para confirmar a exclusao." })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
