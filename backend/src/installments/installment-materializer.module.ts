import { Module } from '@nestjs/common';
import { InstallmentMaterializerService } from './installment-materializer.service';

/**
 * So o gerador de parcelas, sem dependencia do LifeEngine: e o que Dashboard,
 * Transactions e os workers importam para nao formar ciclo de modulos.
 */
@Module({
  providers: [InstallmentMaterializerService],
  exports: [InstallmentMaterializerService],
})
export class InstallmentMaterializerModule {}
