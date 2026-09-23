import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { CreateInstallmentPurchaseDto } from './dto/create-installment-purchase.dto';
import { InstallmentsService } from './installments.service';

@ApiTags('installments')
@ApiBearerAuth()
@Controller('installments')
export class InstallmentsController {
  constructor(private readonly installmentsService: InstallmentsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista as compras parceladas do usuario' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.installmentsService.list(user.sub);
  }

  @Post()
  @ApiOperation({ summary: 'Registra uma compra parcelada (gera a 1a parcela na hora)' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateInstallmentPurchaseDto) {
    return this.installmentsService.create(user.sub, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancela as parcelas futuras (as ja geradas permanecem)' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.installmentsService.remove(user.sub, id);
  }
}
