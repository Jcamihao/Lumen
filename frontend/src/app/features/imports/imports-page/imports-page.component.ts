import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ImportJobHistoryEntry,
  ImportPreview,
  ReceiptImportItem,
  ReceiptImportItemPriceComparison,
  ReceiptImportPreview,
  ReceiptScanHistoryEntry,
} from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { formatDayLabel } from '../../../core/utils/date.utils';
import { formatCurrency } from '../../../core/utils/money.utils';
import { ToastService } from '../../../core/services/toast.service';

@Component({
    selector: 'app-imports-page',
    imports: [CommonModule, FormsModule],
    templateUrl: './imports-page.component.html',
    styleUrls: ['./imports-page.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ImportsPageComponent {
  private readonly api = inject(LifeApiService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly duplicateBox = viewChild<ElementRef<HTMLElement>>('duplicateBox');

  protected readonly preview = signal<ImportPreview | null>(null);
  protected readonly activeTab = signal<'receipt' | 'csv' | 'history'>('receipt');
  protected readonly receiptPreview = signal<ReceiptImportPreview | null>(null);
  protected readonly receiptLoading = signal(false);
  protected readonly receiptSaving = signal(false);
  protected readonly editingReceiptItemIndex = signal<number | null>(null);
  protected readonly receiptError = signal<string | null>(null);
  protected readonly receiptMerchantName = signal('');
  protected readonly receiptPurchaseDate = signal('');
  protected readonly receiptTotalAmount = signal(0);
  protected readonly receiptDescription = signal('');
  protected readonly receiptCategoryId = signal('');

  // Grupo de tags: escolhido ANTES do upload — o grupo e quem define o que
  // pode ser comparado com o que (ver InsightsService.detectReceiptComparison
  // no backend).
  protected readonly selectedTagGroupId = signal('');
  protected readonly compareWithPrevious = signal(false);
  protected readonly newTagGroupName = signal('');
  protected readonly creatingTagGroup = signal(false);
  protected readonly tagGroupError = signal<string | null>(null);

  // History
  protected readonly receiptHistory = signal<ReceiptScanHistoryEntry[]>([]);
  protected readonly csvHistory = signal<ImportJobHistoryEntry[]>([]);
  protected readonly historyLoading = signal(false);
  protected readonly historyLoaded = signal(false);

  protected readonly expenseCategories = computed(
    () => this.auth.currentUser()?.financeCategories.filter((c) => c.type === 'EXPENSE') || [],
  );
  protected readonly tagGroups = computed(() => this.auth.currentUser()?.tagGroups ?? []);

  // Caixa de duplicata: aberta pela prévia (possibleDuplicate) ou pelo 409 do commit.
  protected readonly duplicateDecisionOpen = signal(false);
  protected readonly duplicateBoxVisible = computed(
    () => this.duplicateDecisionOpen() || !!this.receiptPreview()?.possibleDuplicate,
  );

  protected readonly receiptWarnings = computed(() => this.receiptPreview()?.extraction?.warnings ?? []);

  // Avisos de leitura que não repetem os já listados em extraction.warnings (o backend copia os dois).
  protected readonly receiptNotes = computed(() => {
    const preview = this.receiptPreview();
    const warnings = new Set(preview?.extraction?.warnings ?? []);
    return (preview?.notes ?? []).filter((note) => !warnings.has(note));
  });

  // Sempre recalculado com os valores na tela: aparece quando o usuário cria uma divergência
  // ao editar e some quando ele a corrige. Compara em centavos para não errar por ponto flutuante.
  protected readonly localTotalMismatch = computed(() => {
    const preview = this.receiptPreview();
    if (!preview || !preview.items.length) return null;

    const itemsCents = preview.items.reduce(
      (sum, item) => sum + Math.round(this.toNumber(item.totalPrice, 0) * 100),
      0,
    );
    const totalCents = Math.round(this.receiptTotalAmount() * 100);
    return Math.abs(itemsCents - totalCents) > 1
      ? { itemsSum: itemsCents / 100, total: totalCents / 100 }
      : null;
  });

  // O "Resumo da compra" também vale só com a quebra por categoria (calculada sem IA).
  protected readonly hasPurchaseSummary = computed(() => {
    const receipt = this.receiptPreview();
    return (
      !!receipt &&
      (!!receipt.purchaseSummary ||
        receipt.spendingSignals.length > 0 ||
        receipt.followUpActions.length > 0 ||
        receipt.categoryBreakdown.length > 0)
    );
  });

  protected handleFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0);
    if (!file) return;

    this.api
      .previewImport(file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((preview) => this.preview.set(preview));
  }

  protected commitImport() {
    const preview = this.preview();
    if (!preview) return;

    this.api
      .commitImport(preview.importJobId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.preview.set(null);
          this.historyLoaded.set(false);
          this.toast.success('Importação concluída com sucesso.');
        },
        error: () => this.toast.error('Não foi possível concluir a importação.'),
      });
  }

  protected handleReceiptFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0);
    if (!file) return;

    // Limpa o campo já: sem isso, reenviar a mesma foto depois de um erro não dispara "change".
    input.value = '';

    if (!this.selectedTagGroupId()) {
      this.receiptError.set('Escolha um grupo antes de enviar a nota fiscal.');
      return;
    }

    this.receiptLoading.set(true);
    this.receiptError.set(null);

    this.api
      .previewReceiptImport(file, this.selectedTagGroupId(), this.compareWithPrevious())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (preview) => {
          this.receiptPreview.set(preview);
          this.duplicateDecisionOpen.set(false);
          this.editingReceiptItemIndex.set(null);
          this.receiptMerchantName.set(preview.merchantName || '');
          this.receiptPurchaseDate.set(preview.purchaseDate ? preview.purchaseDate.slice(0, 10) : '');
          this.receiptTotalAmount.set(preview.totalAmount);
          this.receiptDescription.set(preview.descriptionSuggestion);
          this.receiptCategoryId.set(preview.suggestedCategoryId || '');
          this.receiptLoading.set(false);
          if (preview.possibleDuplicate) this.revealDuplicateBox();
        },
        error: (error) => {
          this.receiptLoading.set(false);
          // Erro novo não pode deixar a prévia anterior na tela.
          this.receiptPreview.set(null);
          this.receiptError.set(
            error?.error?.message || 'Não consegui ler esta nota. Tente outra foto ou lance o gasto pelo chat.',
          );
        },
      });
  }

  protected selectTagGroup(id: string) {
    this.selectedTagGroupId.set(id);
    this.tagGroupError.set(null);
  }

  protected createTagGroupInline() {
    const name = this.newTagGroupName().trim();
    if (!name) return;

    this.creatingTagGroup.set(true);
    this.tagGroupError.set(null);

    this.api
      .createTagGroup({ name })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (group) => {
          this.auth
            .loadMe()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => {
              this.selectedTagGroupId.set(group.id);
              this.newTagGroupName.set('');
              this.creatingTagGroup.set(false);
            });
        },
        error: (error) => {
          this.creatingTagGroup.set(false);
          this.tagGroupError.set(
            error?.error?.message || 'Não foi possível criar o grupo.',
          );
        },
      });
  }

  protected updateReceiptItem(
    index: number,
    key: keyof ReceiptImportItem,
    value: string | number | null,
    recalculateTotal = false,
  ) {
    const preview = this.receiptPreview();
    if (!preview) return;

    const items = preview.items.map((item, itemIndex) => {
      if (itemIndex !== index) return item;

      const nextItem = { ...item, [key]: value } as ReceiptImportItem;

      if (recalculateTotal && nextItem.unitPrice !== null) {
        nextItem.totalPrice = Number(
          (Number(nextItem.quantity || 0) * Number(nextItem.unitPrice || 0)).toFixed(2),
        );
      }

      return nextItem;
    });

    this.receiptPreview.set({ ...preview, items });
  }

  protected commitReceipt() {
    const preview = this.receiptPreview();
    if (!preview) return;

    // Só vai true quando a caixa de duplicata está visível e o usuário clicou no botão dela.
    const acknowledgeDuplicate = this.duplicateBoxVisible();

    this.receiptSaving.set(true);
    this.receiptError.set(null);

    this.api
      .commitReceiptImport({
        receiptScanId: preview.receiptScanId,
        merchantName: this.receiptMerchantName(),
        description: this.receiptDescription(),
        purchaseDate: this.receiptPurchaseDate() || null,
        totalAmount: this.receiptTotalAmount(),
        categoryId: this.receiptCategoryId() || null,
        items: preview.items.map((item) => ({
          description: item.description,
          quantity: this.toNumber(item.quantity, 1),
          unitPrice: this.toNullableNumber(item.unitPrice),
          totalPrice: this.toNumber(item.totalPrice, 0),
        })),
        ...(acknowledgeDuplicate ? { acknowledgeDuplicate: true } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.receiptSaving.set(false);
          this.receiptPreview.set(null);
          this.duplicateDecisionOpen.set(false);
          this.editingReceiptItemIndex.set(null);
          this.receiptMerchantName.set('');
          this.receiptPurchaseDate.set('');
          this.receiptTotalAmount.set(0);
          this.receiptDescription.set('');
          this.receiptCategoryId.set('');
          this.selectedTagGroupId.set('');
          this.compareWithPrevious.set(false);
          this.historyLoaded.set(false);
          this.toast.success('Nota fiscal registrada no financeiro.');
        },
        error: (error) => {
          this.receiptSaving.set(false);
          // 409: a chave foi importada no meio-tempo. Abre a caixa e deixa o usuário decidir.
          if (error?.status === 409 && error?.error?.code === 'RECEIPT_DUPLICATE_UNCONFIRMED') {
            this.duplicateDecisionOpen.set(true);
            this.revealDuplicateBox();
            return;
          }
          // Mesma mensagem na tela e no toast, para não haver dois textos diferentes para o mesmo erro.
          const message = error?.error?.message || 'Não foi possível registrar a compra no financeiro.';
          this.receiptError.set(message);
          this.toast.error(message);
        },
      });
  }

  // A caixa abre no topo da prévia; o botão de confirmar fica no fim. Traz a caixa para a tela
  // antes de o usuário poder clicar em "Importar mesmo assim" sem tê-la lido.
  private revealDuplicateBox() {
    afterNextRender(
      () => this.duplicateBox()?.nativeElement.scrollIntoView?.({ block: 'center' }),
      { injector: this.injector },
    );
  }

  protected selectTab(tab: 'receipt' | 'csv' | 'history') {
    this.activeTab.set(tab);
    if (tab === 'history' && !this.historyLoaded()) {
      this.loadHistory();
    }
  }

  protected loadHistory() {
    this.historyLoading.set(true);

    this.api
      .listReceiptHistory()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (scans) => {
          this.receiptHistory.set(scans);
          this.loadCsvHistory();
        },
        error: () => {
          this.historyLoading.set(false);
          this.historyLoaded.set(true);
          this.toast.error('Não foi possível carregar o histórico.');
        },
      });
  }

  private loadCsvHistory() {
    this.api
      .listCsvImportHistory()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (jobs) => {
          this.csvHistory.set(jobs);
          this.historyLoading.set(false);
          this.historyLoaded.set(true);
        },
        error: () => {
          this.historyLoading.set(false);
          this.historyLoaded.set(true);
        },
      });
  }

  protected updateCsvRow(index: number, key: string, value: string | number) {
    const current = this.preview();
    if (!current) return;

    const rows = current.rows.map((row, i) => (i === index ? { ...row, [key]: value } : row));
    this.preview.set({ ...current, rows });
  }

  protected receiptStatusLabel(status: string) {
    return status === 'IMPORTED' ? 'Importada' : 'Preview';
  }

  protected importJobStatusLabel(status: string) {
    return status === 'IMPORTED' ? 'Importado' : 'Preview';
  }

  protected receiptStatusTone(status: string) {
    return status === 'IMPORTED' ? 'success' : 'warning';
  }

  /** Data de compra da nota (so dia), sem deslocar pelo fuso. */
  protected purchaseDateLabel(value: string) {
    return formatDayLabel(value);
  }

  protected historyDateLabel(dateStr: string) {
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(dateStr));
  }

  protected previewAmount(amount: number) {
    const currency = this.auth.currentUser()?.preferredCurrency ?? 'BRL';
    return formatCurrency(Number(amount || 0), currency);
  }

  protected comparisonHistoryLabel(comparison: ReceiptImportItemPriceComparison) {
    return `${comparison.historyCount} compra(s) parecida(s) salva(s)`;
  }

  protected comparisonSummary(comparison: ReceiptImportItemPriceComparison) {
    const merchantName = comparison.cheapestMerchantName || 'estabelecimento anterior';
    const purchaseDate = comparison.cheapestPurchaseDate
      ? formatDayLabel(comparison.cheapestPurchaseDate)
      : null;
    const bestPrice = this.previewAmount(comparison.lowestUnitPrice);
    const delta = comparison.currentVsLowestAmount;

    if (delta === null) return `Melhor histórico em ${merchantName}: ${bestPrice}${purchaseDate ? ` em ${purchaseDate}` : ''}.`;
    if (delta > 0.01) return `Agora está ${this.previewAmount(delta)} acima do melhor preço salvo em ${merchantName}${purchaseDate ? ` (${purchaseDate})` : ''}.`;
    if (delta < -0.01) return `Agora está ${this.previewAmount(Math.abs(delta))} abaixo do melhor preço salvo em ${merchantName}${purchaseDate ? ` (${purchaseDate})` : ''}.`;
    return `Preço atual empatado com o melhor histórico em ${merchantName}${purchaseDate ? ` (${purchaseDate})` : ''}.`;
  }

  protected comparisonDeltaTone(comparison: ReceiptImportItemPriceComparison) {
    const delta = comparison.currentVsLowestAmount;
    if (delta === null) return 'info';
    if (delta > 0.01) return 'warning';
    if (delta < -0.01) return 'success';
    return 'accent';
  }

  // O backend manda o rótulo sem acento; a tela mostra com acento, como no resto da nota.
  protected bucketLabel(label: string) {
    return label === 'Sem sugestao' ? 'Sem sugestão' : label;
  }

  protected merchantLabel(merchantName: string | null) {
    return merchantName || 'Estabelecimento sem nome';
  }

  protected confidenceLabel(confidence: 'low' | 'medium' | 'high') {
    if (confidence === 'high') return 'Alta confiança';
    if (confidence === 'low') return 'Baixa confiança';
    return 'Média confiança';
  }

  protected documentTypeLabel(documentType: string) {
    const normalized = String(documentType || '').trim().toLowerCase();
    if (normalized === 'nfce') return 'DANFE NFC-e';
    if (normalized === 'sat') return 'Cupom SAT';
    if (normalized === 'nfe') return 'NF-e';
    if (normalized === 'coupon') return 'Cupom fiscal';
    if (normalized === 'receipt') return 'Comprovante';
    return documentType;
  }

  protected shortenQrText(value: string) {
    const normalized = String(value || '').trim();
    if (normalized.length <= 56) return normalized;
    return `${normalized.slice(0, 40)}...${normalized.slice(-12)}`;
  }

  protected toNumber(value: unknown, fallback = 0) {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : fallback;
  }

  protected toNullableNumber(value: unknown) {
    if (value === null || value === undefined || value === '') return null;
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : null;
  }

  protected isEditingReceiptItem(index: number) {
    return this.editingReceiptItemIndex() === index;
  }

  protected startEditingReceiptItem(index: number) {
    this.editingReceiptItemIndex.set(index);
  }

  protected stopEditingReceiptItem() {
    this.editingReceiptItemIndex.set(null);
  }
}
