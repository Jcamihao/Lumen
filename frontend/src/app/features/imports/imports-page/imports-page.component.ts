import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ImportPreview,
  ReceiptImportItem,
  ReceiptImportPreview,
} from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { ListItemComponent } from '../../../shared/components/list-item/list-item.component';
import { PanelComponent } from '../../../shared/components/panel/panel.component';
import { UiBadgeComponent } from '../../../shared/components/ui-badge/ui-badge.component';
import { UiButtonComponent } from '../../../shared/components/ui-button/ui-button.component';

@Component({
  selector: 'app-imports-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PanelComponent,
    EmptyStateComponent,
    UiButtonComponent,
    UiBadgeComponent,
    ListItemComponent,
  ],
  templateUrl: './imports-page.component.html',
  styleUrls: ['./imports-page.component.scss'],
})
export class ImportsPageComponent {
  private readonly api = inject(LifeApiService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly preview = signal<ImportPreview | null>(null);
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
  protected readonly expenseCategories = computed(
    () =>
      this.auth
        .currentUser()
        ?.financeCategories.filter((category) => category.type === 'EXPENSE') || [],
  );
  protected readonly canUseReceiptAi = computed(() => {
    const user = this.auth.currentUser();
    return !!(
      user?.privacyNoticeAcceptedAt &&
      user?.aiAssistantEnabled &&
      user?.aiAssistantConsentAt
    );
  });

  protected handleFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0);

    if (!file) {
      return;
    }

    this.api
      .previewImport(file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((preview) => this.preview.set(preview));
  }

  protected commitImport() {
    const preview = this.preview();

    if (!preview) {
      return;
    }

    this.api
      .commitImport(preview.importJobId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.preview.set(null));
  }

  protected handleReceiptFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0);

    if (!file) {
      return;
    }

    this.receiptLoading.set(true);
    this.receiptError.set(null);

    this.api
      .previewReceiptImport(file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (preview) => {
          this.receiptPreview.set(preview);
          this.editingReceiptItemIndex.set(null);
          this.receiptMerchantName.set(preview.merchantName || '');
          this.receiptPurchaseDate.set(
            preview.purchaseDate ? preview.purchaseDate.slice(0, 10) : '',
          );
          this.receiptTotalAmount.set(preview.totalAmount);
          this.receiptDescription.set(preview.descriptionSuggestion);
          this.receiptCategoryId.set(preview.suggestedCategoryId || '');
          this.receiptLoading.set(false);
        },
        error: (error) => {
          this.receiptLoading.set(false);
          this.receiptError.set(
            error?.error?.message ||
              'Nao foi possivel ler a nota fiscal com o SelahIA.',
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

    if (!preview) {
      return;
    }

    const items = preview.items.map((item, itemIndex) => {
      if (itemIndex !== index) {
        return item;
      }

      const nextItem = {
        ...item,
        [key]: value,
      } as ReceiptImportItem;

      if (recalculateTotal && nextItem.unitPrice !== null) {
        nextItem.totalPrice = Number(
          (Number(nextItem.quantity || 0) * Number(nextItem.unitPrice || 0)).toFixed(2),
        );
      }

      return nextItem;
    });

    this.receiptPreview.set({
      ...preview,
      items,
    });
  }

  protected commitReceipt() {
    const preview = this.receiptPreview();

    if (!preview) {
      return;
    }

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
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.receiptSaving.set(false);
          this.receiptPreview.set(null);
          this.editingReceiptItemIndex.set(null);
          this.receiptMerchantName.set('');
          this.receiptPurchaseDate.set('');
          this.receiptTotalAmount.set(0);
          this.receiptDescription.set('');
          this.receiptCategoryId.set('');
        },
        error: (error) => {
          this.receiptSaving.set(false);
          this.receiptError.set(
            error?.error?.message ||
              'Nao foi possivel registrar a compra no financeiro.',
          );
        },
      });
  }

  protected previewAmount(amount: number) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      maximumFractionDigits: 2,
    }).format(Number(amount || 0));
  }

  protected confidenceLabel(confidence: 'low' | 'medium' | 'high') {
    if (confidence === 'high') {
      return 'Alta confiança';
    }

    if (confidence === 'low') {
      return 'Baixa confiança';
    }

    return 'Média confiança';
  }

  protected documentTypeLabel(documentType: string) {
    const normalized = String(documentType || '').trim().toLowerCase();

    if (normalized === 'nfce') {
      return 'DANFE NFC-e';
    }

    if (normalized === 'sat') {
      return 'Cupom SAT';
    }

    if (normalized === 'nfe') {
      return 'NF-e';
    }

    if (normalized === 'coupon') {
      return 'Cupom fiscal';
    }

    if (normalized === 'receipt') {
      return 'Comprovante';
    }

    return documentType;
  }

  protected shortenQrText(value: string) {
    const normalized = String(value || '').trim();
    if (normalized.length <= 56) {
      return normalized;
    }

    return `${normalized.slice(0, 40)}...${normalized.slice(-12)}`;
  }

  protected toNumber(value: unknown, fallback = 0) {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : fallback;
  }

  protected toNullableNumber(value: unknown) {
    if (value === null || value === undefined || value === '') {
      return null;
    }

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
