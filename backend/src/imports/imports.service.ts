import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ImportJobStatus,
  NotificationType,
  Prisma,
  ReceiptScanStatus,
  TransactionType,
} from '@prisma/client';
import { endOfDay, startOfDay } from 'date-fns';
import { parse } from 'csv-parse/sync';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { LifeEngineService } from '../life-engine/life-engine.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CommitImportDto } from './dto/commit-import.dto';
import {
  CommitReceiptImportDto,
  CommitReceiptImportItemDto,
} from './dto/commit-receipt-import.dto';

type ParsedRow = {
  type: TransactionType;
  description: string;
  amount: number;
  date: string;
  categoryName?: string;
  duplicate: boolean;
};

type ReceiptParseResponse = {
  merchantName?: unknown;
  merchantTaxId?: unknown;
  documentNumber?: unknown;
  documentType?: unknown;
  accessKey?: unknown;
  purchaseDate?: unknown;
  totalAmount?: unknown;
  subtotalAmount?: unknown;
  taxAmount?: unknown;
  currency?: unknown;
  confidence?: unknown;
  qrCodeDetected?: unknown;
  qrCodeText?: unknown;
  notes?: unknown;
  rawTextExcerpt?: unknown;
  provider?: unknown;
  model?: unknown;
  generatedAt?: unknown;
  items?: unknown;
};

type NormalizedReceiptItem = {
  description: string;
  quantity: number;
  unitPrice: number | null;
  totalPrice: number;
  categoryHint: string | null;
};

type ReceiptPreviewData = {
  notes: string[];
  rawTextExcerpt: string | null;
  possibleDuplicate: boolean;
  duplicateTransactionId: string | null;
  duplicateTransactionDescription: string | null;
  suggestedCategoryId: string | null;
  suggestedCategoryName: string | null;
  documentType: string | null;
  merchantTaxId: string | null;
  accessKey: string | null;
  qrCodeDetected: boolean;
  qrCodeText: string | null;
  itemCategoryHints: Array<string | null>;
  provider: string | null;
  model: string | null;
  generatedAt: string | null;
};

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifeEngineService: LifeEngineService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async previewTransactionsImport(userId: string, file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Envie um arquivo CSV no campo file.');
    }

    const rows = parse(file.buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    if (rows.length === 0) {
      throw new BadRequestException('O arquivo CSV esta vazio.');
    }

    const normalizedRows = rows.map((rawRow: Record<string, string>) =>
      Object.entries(rawRow).reduce<Record<string, string>>(
        (accumulator, [key, value]) => {
          accumulator[key.trim().toLowerCase()] = value;
          return accumulator;
        },
        {},
      ),
    );

    const previewRows: ParsedRow[] = [];
    const seenInFile = new Set<string>();

    for (const row of normalizedRows) {
      const type = this.normalizeType(row.type ?? row.tipo);
      const description = row.description ?? row.descricao;
      const amount = Number(String(row.amount ?? row.valor ?? '0').replace(',', '.'));
      const date = row.date ?? row.data;
      const categoryName = row.category ?? row.categoria;

      if (!type || !description || Number.isNaN(amount) || !date) {
        throw new BadRequestException(
          'Cada linha do CSV precisa ter tipo, descricao, valor e data.',
        );
      }

      const fingerprint = `${type}:${description.toLowerCase()}:${amount}:${date}`;
      const exists = await this.prisma.transaction.findFirst({
        where: {
          userId,
          type,
          description,
          amount: new Prisma.Decimal(amount),
          date: new Date(date),
        },
      });
      const duplicate = seenInFile.has(fingerprint) || !!exists;
      seenInFile.add(fingerprint);

      previewRows.push({
        type,
        description,
        amount,
        date,
        categoryName,
        duplicate,
      });
    }

    const importJob = await this.prisma.importJob.create({
      data: {
        userId,
        fileName: file.originalname,
        status: ImportJobStatus.PREVIEWED,
        totalRows: previewRows.length,
        importedRows: 0,
        deduplicatedRows: previewRows.filter((row) => row.duplicate).length,
        previewData: {
          rows: previewRows,
        },
      },
    });

    return {
      importJobId: importJob.id,
      fileName: importJob.fileName,
      totalRows: previewRows.length,
      duplicates: previewRows.filter((row) => row.duplicate).length,
      rows: previewRows,
    };
  }

  async commitTransactionsImport(userId: string, dto: CommitImportDto) {
    const importJob = await this.prisma.importJob.findFirst({
      where: {
        id: dto.importJobId,
        userId,
      },
    });

    if (!importJob) {
      throw new NotFoundException('Importacao nao encontrada.');
    }

    const previewRows = ((importJob.previewData as any)?.rows ?? []) as ParsedRow[];

    if (previewRows.length === 0) {
      throw new BadRequestException('Nao ha dados de preview para importar.');
    }

    const shouldSkipDuplicates = dto.skipDuplicates ?? true;
    let importedRows = 0;

    for (const row of previewRows) {
      if (shouldSkipDuplicates && row.duplicate) {
        continue;
      }

      const category = row.categoryName
        ? await this.prisma.financeCategory.findFirst({
            where: {
              userId,
              name: row.categoryName,
              type: row.type,
            },
          })
        : null;

      await this.prisma.transaction.create({
        data: {
          userId,
          type: row.type,
          description: row.description,
          amount: new Prisma.Decimal(Math.abs(row.amount)),
          date: new Date(row.date),
          categoryId: category?.id,
        },
      });
      importedRows += 1;
    }

    await this.prisma.importJob.update({
      where: { id: importJob.id },
      data: {
        status: ImportJobStatus.IMPORTED,
        importedRows,
      },
    });

    await this.notificationsService.createNotification(
      userId,
      NotificationType.IMPORT,
      'Importacao concluida',
      `${importedRows} transacao(oes) foram importadas para o LUMEN.`,
    );
    await this.lifeEngineService.touchUserData(userId);

    return {
      success: true,
      importedRows,
      skippedRows: previewRows.length - importedRows,
    };
  }

  async previewReceiptImport(userId: string, file?: Express.Multer.File) {
    this.ensureReceiptFile(file);
    const aiContext = await this.ensureReceiptAiEnabled(userId);
    const parsedReceipt = await this.parseReceiptWithSelah(file!, aiContext.expenseCategoryNames);

    const merchantName = this.optionalString(parsedReceipt.merchantName);
    const purchaseDate = this.toDateOrNull(this.optionalString(parsedReceipt.purchaseDate));
    const totalAmount = this.requiredPositiveNumber(parsedReceipt.totalAmount, 'totalAmount');
    const subtotalAmount = this.optionalNumber(parsedReceipt.subtotalAmount);
    const taxAmount = this.optionalNumber(parsedReceipt.taxAmount);
    const confidence = this.normalizeConfidence(parsedReceipt.confidence);
    const items = this.normalizeReceiptItems(parsedReceipt.items);
    const documentType = this.normalizeDocumentType(parsedReceipt.documentType);
    const merchantTaxId = this.optionalString(parsedReceipt.merchantTaxId);
    const accessKey = this.normalizeAccessKey(parsedReceipt.accessKey);
    const qrCodeText = this.optionalString(parsedReceipt.qrCodeText);
    const qrCodeDetected = Boolean(parsedReceipt.qrCodeDetected || qrCodeText);
    const duplicateMatch = await this.findPossibleDuplicateTransaction(
      userId,
      totalAmount,
      purchaseDate,
      merchantName,
    );
    const suggestedCategory = this.suggestExpenseCategory(
      aiContext.expenseCategories,
      merchantName,
      items,
    );

    const previewData: ReceiptPreviewData = {
      notes: this.readStringList(parsedReceipt.notes, 6),
      rawTextExcerpt: this.optionalString(parsedReceipt.rawTextExcerpt),
      possibleDuplicate: !!duplicateMatch,
      duplicateTransactionId: duplicateMatch?.id ?? null,
      duplicateTransactionDescription: duplicateMatch?.description ?? null,
      suggestedCategoryId: suggestedCategory?.id ?? null,
      suggestedCategoryName: suggestedCategory?.name ?? null,
      documentType,
      merchantTaxId,
      accessKey,
      qrCodeDetected,
      qrCodeText,
      itemCategoryHints: items.map((item) => item.categoryHint),
      provider: this.optionalString(parsedReceipt.provider),
      model: this.optionalString(parsedReceipt.model),
      generatedAt: this.optionalString(parsedReceipt.generatedAt),
    };

    const receiptScan = await this.prisma.receiptScan.create({
      data: {
        userId,
        fileName: file!.originalname,
        mimeType: file!.mimetype,
        status: ReceiptScanStatus.PREVIEWED,
        merchantName,
        documentNumber: this.optionalString(parsedReceipt.documentNumber),
        purchaseDate,
        totalAmount: new Prisma.Decimal(totalAmount),
        subtotalAmount:
          subtotalAmount !== null ? new Prisma.Decimal(subtotalAmount) : undefined,
        taxAmount: taxAmount !== null ? new Prisma.Decimal(taxAmount) : undefined,
        currency: this.optionalString(parsedReceipt.currency) ?? 'BRL',
        confidence,
        rawText: previewData.rawTextExcerpt,
        previewData,
        items: {
          create: items.map((item, index) => ({
            description: item.description,
            quantity: new Prisma.Decimal(item.quantity),
            unitPrice:
              item.unitPrice !== null ? new Prisma.Decimal(item.unitPrice) : undefined,
            totalPrice: new Prisma.Decimal(item.totalPrice),
            sortOrder: index,
          })),
        },
      },
      include: {
        items: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    return this.serializeReceiptPreview(receiptScan);
  }

  async commitReceiptImport(userId: string, dto: CommitReceiptImportDto) {
    const receiptScan = await this.prisma.receiptScan.findFirst({
      where: {
        id: dto.receiptScanId,
        userId,
      },
      include: {
        items: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!receiptScan) {
      throw new NotFoundException('Leitura da nota fiscal nao encontrada.');
    }

    if (receiptScan.status === ReceiptScanStatus.IMPORTED && receiptScan.transactionId) {
      throw new BadRequestException('Esta nota fiscal ja foi importada.');
    }

    const categoryId =
      dto.categoryId || this.previewData(receiptScan).suggestedCategoryId || undefined;

    if (categoryId) {
      const category = await this.prisma.financeCategory.findFirst({
        where: {
          id: categoryId,
          userId,
          type: TransactionType.EXPENSE,
        },
      });

      if (!category) {
        throw new NotFoundException(
          'Categoria financeira invalida para importacao de nota.',
        );
      }
    }

    const merchantName =
      dto.merchantName?.trim() || receiptScan.merchantName || 'Compra registrada';
    const totalAmount =
      dto.totalAmount !== undefined
        ? Math.abs(Number(dto.totalAmount))
        : Number(receiptScan.totalAmount);
    const purchaseDate =
      this.toDateOrNull(dto.purchaseDate) ??
      receiptScan.purchaseDate ??
      new Date();
    const description =
      dto.description?.trim() ||
      this.buildReceiptTransactionDescription(merchantName);
    const normalizedItems = this.normalizeCommitItems(dto.items, receiptScan.items);

    const transaction = await this.prisma.$transaction(async (tx) => {
      if (dto.items?.length) {
        await tx.receiptScanItem.deleteMany({
          where: { receiptScanId: receiptScan.id },
        });
        await tx.receiptScanItem.createMany({
          data: normalizedItems.map((item, index) => ({
            receiptScanId: receiptScan.id,
            description: item.description,
            quantity: new Prisma.Decimal(item.quantity),
            unitPrice:
              item.unitPrice !== null ? new Prisma.Decimal(item.unitPrice) : null,
            totalPrice: new Prisma.Decimal(item.totalPrice),
            sortOrder: index,
          })),
        });
      }

      const createdTransaction = await tx.transaction.create({
        data: {
          userId,
          type: TransactionType.EXPENSE,
          description,
          amount: new Prisma.Decimal(totalAmount),
          date: purchaseDate,
          categoryId,
        },
        include: {
          category: true,
          task: true,
          goal: true,
        },
      });

      await tx.receiptScan.update({
        where: { id: receiptScan.id },
        data: {
          merchantName,
          purchaseDate,
          totalAmount: new Prisma.Decimal(totalAmount),
          status: ReceiptScanStatus.IMPORTED,
          importedAt: new Date(),
          transactionId: createdTransaction.id,
        },
      });

      return createdTransaction;
    });

    await this.notificationsService.createNotification(
      userId,
      NotificationType.IMPORT,
      'Nota fiscal registrada',
      `${description} foi registrada com ${normalizedItems.length} item(ns) no LUMEN.`,
    );
    await this.lifeEngineService.touchUserData(userId);

    return {
      success: true,
      receiptScanId: receiptScan.id,
      importedItems: normalizedItems.length,
      transaction: {
        ...transaction,
        amount: Number(transaction.amount),
      },
    };
  }

  private ensureReceiptFile(file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Envie uma imagem da nota fiscal no campo file.');
    }

    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException(
        'Envie uma imagem valida da nota fiscal em JPG, PNG, WEBP ou similar.',
      );
    }

    const maxSizeBytes = 8 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      throw new BadRequestException('A imagem da nota deve ter no maximo 8 MB.');
    }
  }

  private async ensureReceiptAiEnabled(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        privacyNoticeAcceptedAt: true,
        aiAssistantEnabled: true,
        aiAssistantConsentAt: true,
        financeCategories: {
          where: { type: TransactionType.EXPENSE },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Usuario nao encontrado.');
    }

    if (
      !user.privacyNoticeAcceptedAt ||
      !user.aiAssistantEnabled ||
      !user.aiAssistantConsentAt
    ) {
      throw new BadRequestException(
        'Ative o uso de IA externa nas configuracoes do LUMEN antes de ler notas fiscais com o SelahIA.',
      );
    }

    return {
      expenseCategories: user.financeCategories,
      expenseCategoryNames: user.financeCategories.map((category) => category.name),
    };
  }

  private async parseReceiptWithSelah(
    file: Express.Multer.File,
    knownCategories: string[],
  ) {
    const enabled = this.readBooleanEnv('SELAH_ASSISTANT_ENABLED');
    const baseUrl = this.readEnv('SELAH_BASE_URL');

    if (!enabled || !baseUrl) {
      throw new BadRequestException(
        'A leitura de nota fiscal por IA nao esta habilitada neste ambiente.',
      );
    }

    const route =
      this.readEnv('SELAH_RECEIPT_ROUTE') ||
      '/v1/adapters/lumen/receipt-parser/parse';
    const apiKey = this.readEnv('SELAH_API_KEY');
    const sourceApp = this.readEnv('SELAH_SOURCE_APP') || 'LumenBack';
    const timeoutMs = this.readReceiptTimeout();
    const url = `${baseUrl.replace(/\/+$/, '')}${route.startsWith('/') ? route : `/${route}`}`;

    const body = JSON.stringify({
      fileName: file.originalname,
      mimeType: file.mimetype,
      imageBase64: file.buffer.toString('base64'),
      preferredCurrency: 'BRL',
      localeHint: 'pt-BR',
      knownCategories,
    });
    let response: { statusCode: number; body: string };

    try {
      response = await this.postJson(
        url,
        body,
        {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(body)),
          'X-Source-App': sourceApp,
          ...(apiKey ? { 'X-Selah-Api-Key': apiKey } : {}),
        },
        timeoutMs,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(`Falha ao consultar o SelahIA: ${message}`);
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new BadRequestException(
        `Falha ao analisar a nota com SelahIA: ${response.body.slice(0, 240)}`,
      );
    }

    try {
      return JSON.parse(response.body) as ReceiptParseResponse;
    } catch (_error) {
      throw new BadRequestException(
        'SelahIA retornou uma resposta invalida para leitura da nota fiscal.',
      );
    }
  }

  private normalizeType(value?: string): TransactionType | null {
    const normalized = value?.trim().toUpperCase();

    if (!normalized) {
      return null;
    }

    if (normalized === 'INCOME' || normalized === 'RECEITA') {
      return TransactionType.INCOME;
    }

    if (normalized === 'EXPENSE' || normalized === 'DESPESA') {
      return TransactionType.EXPENSE;
    }

    if (normalized === 'TRANSFER' || normalized === 'TRANSFERENCIA') {
      return TransactionType.TRANSFER;
    }

    return null;
  }

  private readBooleanEnv(key: string) {
    const value = String(process.env[key] || '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(value);
  }

  private readEnv(key: string) {
    return String(process.env[key] || '').trim() || null;
  }

  private readReceiptTimeout() {
    return Math.max(
      15000,
      Number(
        process.env.SELAH_RECEIPT_TIMEOUT_MS ||
          process.env.SELAH_TIMEOUT_MS ||
          60000,
      ),
    );
  }

  private optionalString(value: unknown) {
    const normalized = String(value || '').trim();
    return normalized || null;
  }

  private optionalNumber(value: unknown) {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : null;
  }

  private requiredPositiveNumber(value: unknown, fieldName: string) {
    const normalized = Number(value);
    if (!Number.isFinite(normalized) || normalized < 0) {
      throw new BadRequestException(`Campo obrigatorio ausente ou invalido: ${fieldName}`);
    }
    return normalized;
  }

  private readStringList(value: unknown, maxItems: number) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, maxItems);
  }

  private normalizeConfidence(value: unknown) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
      return normalized;
    }

    return 'medium';
  }

  private normalizeDocumentType(value: unknown) {
    const normalized = this.normalizeText(String(value || ''));

    if (!normalized) {
      return null;
    }

    if (normalized.includes('nfce') || normalized.includes('nfc e') || normalized.includes('danfe')) {
      return 'nfce';
    }

    if (normalized.includes('sat') || normalized.includes('cf e') || normalized.includes('cfe')) {
      return 'sat';
    }

    if (normalized.includes('nfe') || normalized.includes('nf e')) {
      return 'nfe';
    }

    if (normalized.includes('cupom')) {
      return 'coupon';
    }

    if (normalized.includes('recibo') || normalized.includes('comprovante')) {
      return 'receipt';
    }

    return normalized || null;
  }

  private normalizeAccessKey(value: unknown) {
    const digits = String(value || '').replace(/\D+/g, '');
    return digits.length >= 36 ? digits.slice(0, 44) : null;
  }

  private toDateOrNull(value?: string | null) {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return null;
    }

    const brDateMatch = normalized.match(/^(\d{2})[\/.-](\d{2})[\/.-](\d{4})$/);
    if (brDateMatch) {
      const [, day, month, year] = brDateMatch;
      const parsed = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed;
  }

  private normalizeReceiptItems(value: unknown): NormalizedReceiptItem[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => item as Record<string, unknown>)
      .filter((item) => this.optionalString(item.description))
      .slice(0, 100)
      .map((item) => {
        const quantity = Math.max(0.001, Number(item.quantity || 1));
        const unitPrice = this.optionalNumber(item.unitPrice);
        const totalPrice =
          this.optionalNumber(item.totalPrice) ??
          (unitPrice !== null ? Number((quantity * unitPrice).toFixed(2)) : 0);
        const description = this.normalizeReceiptItemDescription(
          this.optionalString(item.description)!,
        );
        const aiHint = this.optionalString(item.categoryHint);

        return {
          description,
          quantity,
          unitPrice,
          totalPrice,
          categoryHint: this.inferReceiptItemCategory(description, aiHint),
        };
      })
      .filter((item) => item.totalPrice >= 0);
  }

  private normalizeCommitItems(
    items: CommitReceiptImportItemDto[] | undefined,
    fallbackItems: Array<{
      description: string;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal | null;
      totalPrice: Prisma.Decimal;
    }>,
  ) {
    if (!items?.length) {
      return fallbackItems.map((item) => ({
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: item.unitPrice !== null ? Number(item.unitPrice) : null,
        totalPrice: Number(item.totalPrice),
      }));
    }

    return items
      .map((item) => ({
        description: item.description.trim(),
        quantity: Math.max(0.001, Number(item.quantity || 1)),
        unitPrice:
          item.unitPrice === null || item.unitPrice === undefined
            ? null
            : Math.max(0, Number(item.unitPrice)),
        totalPrice: Math.max(0, Number(item.totalPrice || 0)),
      }))
      .filter((item) => !!item.description);
  }

  private async findPossibleDuplicateTransaction(
    userId: string,
    totalAmount: number,
    purchaseDate: Date | null,
    merchantName: string | null,
  ) {
    return this.prisma.transaction.findFirst({
      where: {
        userId,
        type: TransactionType.EXPENSE,
        amount: new Prisma.Decimal(totalAmount),
        date: purchaseDate
          ? {
              gte: startOfDay(purchaseDate),
              lte: endOfDay(purchaseDate),
            }
          : undefined,
        description: merchantName
          ? {
              contains: merchantName,
              mode: 'insensitive',
            }
          : undefined,
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        description: true,
      },
    });
  }

  private normalizeReceiptItemDescription(value: string) {
    return String(value || '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\d.\-xX]+\s+/, '')
      .trim();
  }

  private inferReceiptItemCategory(description: string, aiHint: string | null) {
    const normalizedHint = this.normalizeProductHint(aiHint);
    if (normalizedHint) {
      return normalizedHint;
    }

    const normalized = this.normalizeText(description);

    const rules: Array<{ label: string; keywords: string[] }> = [
      {
        label: 'Alimentacao',
        keywords: ['arroz', 'feij', 'macarrao', 'carne', 'frango', 'queijo', 'pao', 'biscoito', 'iogurte', 'cafe', 'acucar', 'farinha'],
      },
      {
        label: 'Bebidas',
        keywords: ['agua', 'refrigerante', 'suco', 'cerveja', 'vinho', 'energetico', 'cha', 'bebida'],
      },
      {
        label: 'Hortifruti',
        keywords: ['banana', 'maca', 'laranja', 'tomate', 'cebola', 'batata', 'alface', 'fruta', 'legume', 'verdura', 'horti'],
      },
      {
        label: 'Limpeza',
        keywords: ['detergente', 'desinfetante', 'amaciante', 'sabao', 'multiuso', 'agua sanitaria', 'esponja', 'limpeza'],
      },
      {
        label: 'Higiene',
        keywords: ['shampoo', 'sabonete', 'creme dental', 'pasta dental', 'desodorante', 'absorvente', 'papel higienico', 'escova dental'],
      },
      {
        label: 'Farmacia',
        keywords: ['paracetamol', 'dipirona', 'ibuprofeno', 'medic', 'remedio', 'vitamina', 'farmacia'],
      },
      {
        label: 'Pet',
        keywords: ['racao', 'petisco pet', 'areia gato', 'pet'],
      },
      {
        label: 'Bebes',
        keywords: ['fralda', 'lenco umedecido', 'formula infantil', 'mamadeira', 'bebe'],
      },
      {
        label: 'Casa',
        keywords: ['lampada', 'pilha', 'panela', 'utensilio', 'toalha', 'tapete', 'casa'],
      },
      {
        label: 'Eletronicos',
        keywords: ['fone', 'cabo', 'mouse', 'teclado', 'carregador', 'eletron'],
      },
      {
        label: 'Vestuario',
        keywords: ['camiseta', 'calca', 'blusa', 'tenis', 'meia', 'vest'],
      },
    ];

    const match = rules.find((rule) =>
      rule.keywords.some((keyword) => normalized.includes(keyword)),
    );

    return match?.label || null;
  }

  private normalizeProductHint(value: string | null) {
    const normalized = this.normalizeText(value || '');

    if (!normalized) {
      return null;
    }

    const aliases: Record<string, string[]> = {
      Alimentacao: ['aliment', 'mercearia', 'comida'],
      Bebidas: ['bebida'],
      Hortifruti: ['hortifruti', 'horti', 'fruta', 'verdura', 'legume', 'feira'],
      Limpeza: ['limpeza'],
      Higiene: ['higiene', 'beleza'],
      Farmacia: ['farm', 'saud', 'medic'],
      Pet: ['pet', 'animal'],
      Bebes: ['bebe', 'infantil'],
      Casa: ['casa', 'lar', 'utilidade'],
      Eletronicos: ['eletron', 'tecnolog', 'informat'],
      Vestuario: ['vest', 'roupa', 'moda'],
      Servicos: ['servico'],
    };

    const normalizedEntry = Object.entries(aliases).find(([, keywords]) =>
      keywords.some((keyword) => normalized.includes(keyword)),
    );

    return normalizedEntry?.[0] || null;
  }

  private suggestExpenseCategory(
    categories: Array<{ id: string; name: string }>,
    merchantName: string | null,
    items: NormalizedReceiptItem[],
  ) {
    const normalizedTexts = [
      merchantName || '',
      ...items.map((item) => item.description),
      ...items.map((item) => item.categoryHint || ''),
    ]
      .map((value) => this.normalizeText(value))
      .join(' ');

    const scoredCategories = categories
      .map((category) => ({
        category,
        score: this.scoreExpenseCategory(category.name, merchantName, items),
      }))
      .sort((left, right) => right.score - left.score);

    if (scoredCategories[0] && scoredCategories[0].score > 0) {
      return scoredCategories[0].category;
    }

    const byKeyword =
      this.pickCategory(categories, ['aliment', 'mercad', 'padar', 'feira', 'horti']) ||
      this.pickCategory(categories, ['farm', 'saud', 'drog']) ||
      this.pickCategory(categories, ['morad', 'conta', 'casa', 'utilidade']) ||
      this.pickCategory(categories, ['transp', 'combust', 'mobilidade']);

    if (normalizedTexts.match(/mercad|padar|horti|fruta|arroz|feij|leite|carne|super/)) {
      return this.pickCategory(categories, ['aliment']) || byKeyword;
    }

    if (normalizedTexts.match(/farm|drog|remed|vitamina/)) {
      return this.pickCategory(categories, ['farm', 'saud']) || byKeyword;
    }

    if (normalizedTexts.match(/energia|agua|internet|luz|aluguel|condominio/)) {
      return this.pickCategory(categories, ['morad', 'conta', 'casa']) || byKeyword;
    }

    return byKeyword || null;
  }

  private scoreExpenseCategory(
    categoryName: string,
    merchantName: string | null,
    items: NormalizedReceiptItem[],
  ) {
    const normalizedCategory = this.normalizeText(categoryName);
    const normalizedTexts = [
      merchantName || '',
      ...items.map((item) => item.description),
      ...items.map((item) => item.categoryHint || ''),
    ]
      .map((value) => this.normalizeText(value))
      .join(' ');

    let score = 0;

    if (normalizedCategory && normalizedTexts.includes(normalizedCategory)) {
      score += 2;
    }

    const itemHintKeywords = items.flatMap((item) =>
      this.financeCategoryKeywordsForProductHint(item.categoryHint),
    );

    if (itemHintKeywords.some((keyword) => normalizedCategory.includes(keyword))) {
      score += 4;
    }

    if (normalizedTexts.match(/farm|remed|vitamina|drog/) && normalizedCategory.match(/farm|saud/)) {
      score += 3;
    }

    if (
      normalizedTexts.match(/mercad|super|padar|feira|horti|arroz|leite|carne|fruta/) &&
      normalizedCategory.match(/aliment|mercad|feira|horti/)
    ) {
      score += 3;
    }

    if (
      normalizedTexts.match(/detergente|sabao|desinfetante|multiuso/) &&
      normalizedCategory.match(/casa|lar|limpeza|utilidade/)
    ) {
      score += 3;
    }

    if (
      normalizedTexts.match(/papel higienico|shampoo|desodorante|sabonete/) &&
      normalizedCategory.match(/higiene|beleza|farm|saud/)
    ) {
      score += 3;
    }

    return score;
  }

  private financeCategoryKeywordsForProductHint(categoryHint: string | null) {
    const normalizedHint = this.normalizeText(categoryHint || '');

    if (!normalizedHint) {
      return [];
    }

    const mapping: Record<string, string[]> = {
      alimentacao: ['aliment', 'mercad', 'super', 'comida'],
      bebidas: ['bebida', 'aliment'],
      hortifruti: ['horti', 'feira', 'aliment'],
      limpeza: ['limpeza', 'casa', 'lar'],
      higiene: ['higiene', 'beleza', 'farm', 'saud'],
      farmacia: ['farm', 'saud'],
      pet: ['pet', 'animal'],
      bebes: ['bebe', 'infantil'],
      casa: ['casa', 'lar', 'utilidade'],
      eletronicos: ['eletron', 'tecnolog', 'informat'],
      vestuario: ['vest', 'roupa', 'moda'],
      servicos: ['servic'],
    };

    const entry = Object.entries(mapping).find(([label]) => normalizedHint.includes(label));
    return entry?.[1] || [];
  }

  private pickCategory(categories: Array<{ id: string; name: string }>, keywords: string[]) {
    return (
      categories.find((category) =>
        keywords.some((keyword) =>
          this.normalizeText(category.name).includes(keyword),
        ),
      ) || null
    );
  }

  private normalizeText(value: string) {
    return String(value || '')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim();
  }

  private previewData(receiptScan: { previewData: Prisma.JsonValue | null }) {
    return (receiptScan.previewData || {}) as ReceiptPreviewData;
  }

  private serializeReceiptPreview(receiptScan: {
    id: string;
    fileName: string;
    merchantName: string | null;
    purchaseDate: Date | null;
    totalAmount: Prisma.Decimal;
    subtotalAmount: Prisma.Decimal | null;
    taxAmount: Prisma.Decimal | null;
    confidence: string;
    items: Array<{
      id: string;
      description: string;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal | null;
      totalPrice: Prisma.Decimal;
    }>;
    previewData: Prisma.JsonValue | null;
  }) {
    const previewData = this.previewData(receiptScan);

    return {
      receiptScanId: receiptScan.id,
      fileName: receiptScan.fileName,
      merchantName: receiptScan.merchantName,
      purchaseDate: receiptScan.purchaseDate?.toISOString() ?? null,
      totalAmount: Number(receiptScan.totalAmount),
      subtotalAmount:
        receiptScan.subtotalAmount !== null ? Number(receiptScan.subtotalAmount) : null,
      taxAmount: receiptScan.taxAmount !== null ? Number(receiptScan.taxAmount) : null,
      confidence: receiptScan.confidence,
      notes: previewData.notes || [],
      rawTextExcerpt: previewData.rawTextExcerpt || null,
      possibleDuplicate: previewData.possibleDuplicate || false,
      duplicateTransactionId: previewData.duplicateTransactionId || null,
      duplicateTransactionDescription:
        previewData.duplicateTransactionDescription || null,
      suggestedCategoryId: previewData.suggestedCategoryId || null,
      suggestedCategoryName: previewData.suggestedCategoryName || null,
      documentType: previewData.documentType || null,
      merchantTaxId: previewData.merchantTaxId || null,
      accessKey: previewData.accessKey || null,
      qrCodeDetected: !!previewData.qrCodeDetected,
      qrCodeText: previewData.qrCodeText || null,
      descriptionSuggestion: this.buildReceiptTransactionDescription(
        receiptScan.merchantName || 'Compra registrada',
      ),
      items: receiptScan.items.map((item, index) => ({
        id: item.id,
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: item.unitPrice !== null ? Number(item.unitPrice) : null,
        totalPrice: Number(item.totalPrice),
        categoryHint: previewData.itemCategoryHints?.[index] || null,
      })),
    };
  }

  private buildReceiptTransactionDescription(merchantName: string) {
    const normalized = String(merchantName || '').trim();

    if (!normalized) {
      return 'Compra registrada';
    }

    if (this.normalizeText(normalized).startsWith('compra ')) {
      return normalized;
    }

    return `Compra em ${normalized}`;
  }

  private postJson(
    rawUrl: string,
    body: string,
    headers: Record<string, string>,
    timeoutMs: number,
  ) {
    return new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const url = new URL(rawUrl);
      const requester = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const request = requester(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port,
          path: `${url.pathname}${url.search}`,
          method: 'POST',
          headers,
          timeout: timeoutMs,
        },
        (response) => {
          const chunks: Buffer[] = [];

          response.on('data', (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });

          response.on('end', () => {
            resolve({
              statusCode: Number(response.statusCode || 0),
              body: Buffer.concat(chunks).toString('utf-8'),
            });
          });
        },
      );

      request.on('error', reject);
      request.on('timeout', () => {
        request.destroy(new Error('Timeout ao consultar o SelahIA.'));
      });
      request.write(body);
      request.end();
    });
  }
}
