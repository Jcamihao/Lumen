import { Module } from '@nestjs/common';
import { RecurringMaterializerService } from './recurring-materializer.service';

/**
 * So o gerador de lancamentos, sem dependencia do LifeEngine: e o que Dashboard,
 * Transactions e os workers importam para nao formar ciclo de modulos.
 */
@Module({
  providers: [RecurringMaterializerService],
  exports: [RecurringMaterializerService],
})
export class RecurringMaterializerModule {}
