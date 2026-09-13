import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class PreviewReceiptImportDto {
  /**
   * O usuario escolhe o grupo ANTES de mandar a foto pra IA. Obrigatorio: sem
   * grupo a nota nao entra na comparacao com a nota anterior.
   */
  @IsString()
  tagGroupId!: string;

  /**
   * Campo multipart chega como string ("true"/"false"), entao converte
   * explicitamente em vez de confiar so no ValidationPipe.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  compareWithPrevious?: boolean;
}
