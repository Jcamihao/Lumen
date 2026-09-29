import { Body, Controller, Delete, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { BillingPaymentsService } from './billing-payments.service';
import { BillingService } from './billing.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { CreateGrantDto } from './dto/create-grant.dto';

@ApiTags('billing')
@ApiBearerAuth()
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly billingPaymentsService: BillingPaymentsService,
  ) {}

  @Public()
  @Get('plans')
  @ApiOperation({ summary: 'Lista os planos, limites e preços' })
  plans() {
    return this.billingService.getPlans();
  }

  @Get('me')
  @ApiOperation({ summary: 'Plano efetivo e uso do usuário logado' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.billingService.getMe(user.sub);
  }

  @Post('checkout')
  @ApiOperation({ summary: 'Cria (ou reaproveita) um checkout do Asaas para assinar' })
  checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCheckoutDto,
  ) {
    return this.billingPaymentsService.checkout(user.sub, dto);
  }

  @Post('sync')
  @ApiOperation({ summary: 'Sincroniza a assinatura do usuario contra o Asaas (rede de seguranca)' })
  sync(@CurrentUser() user: AuthenticatedUser) {
    return this.billingPaymentsService.sync(user.sub);
  }

  @Post('cancel')
  @ApiOperation({ summary: 'Cancela a assinatura ASAAS do usuario logado' })
  cancel(@CurrentUser() user: AuthenticatedUser) {
    return this.billingPaymentsService.cancel(user.sub);
  }

  @Public()
  @Post('webhooks/asaas')
  @ApiOperation({ summary: 'Recebe eventos do Asaas (checkout, assinatura, pagamento)' })
  webhook(
    @Headers('asaas-access-token') token: string | undefined,
    @Body() payload: Record<string, unknown>,
  ) {
    return this.billingPaymentsService.processWebhookEvent(token, payload);
  }

  @Get('admin/grants')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '[Admin] Lista concessões de plano' })
  listGrants() {
    return this.billingService.listGrants();
  }

  @Post('admin/grants')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '[Admin] Concede um plano a um usuário pelo e-mail' })
  createGrant(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateGrantDto) {
    return this.billingService.createGrant(user.sub, dto);
  }

  @Delete('admin/grants/:id')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: '[Admin] Revoga uma concessão (idempotente)' })
  revokeGrant(@Param('id') id: string) {
    return this.billingService.revokeGrant(id);
  }
}
