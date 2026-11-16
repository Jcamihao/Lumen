import { registerLocaleData } from "@angular/common";
import localePt from "@angular/common/locales/pt";
import { LOCALE_ID, signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { of, throwError } from "rxjs";
import { ReceiptImportPreview } from "../../../core/models/domain.models";
import { AuthService } from "../../../core/services/auth.service";
import { LifeApiService } from "../../../core/services/life-api.service";
import { ToastService } from "../../../core/services/toast.service";
import { ImportsPageComponent } from "./imports-page.component";

// O app registra o pt-BR no main.ts; o ambiente de teste não passa por lá.
registerLocaleData(localePt);

const receipt = (overrides: Partial<ReceiptImportPreview> = {}): ReceiptImportPreview =>
  ({
    receiptScanId: "scan-1",
    fileName: "nota.jpg",
    merchantName: "Mercado Teste",
    merchantTaxId: null,
    documentType: "nfce",
    accessKey: null,
    purchaseDate: "2026-11-15T00:00:00.000Z",
    totalAmount: 10,
    subtotalAmount: null,
    taxAmount: null,
    confidence: "high",
    qrCodeDetected: false,
    qrCodeText: null,
    purchaseSummary: null,
    purchaseMission: null,
    spendingSignals: [],
    followUpActions: [],
    categoryBreakdown: [],
    notes: [],
    rawTextExcerpt: null,
    possibleDuplicate: false,
    duplicateTransactionId: null,
    duplicateTransactionDescription: null,
    suggestedCategoryId: null,
    suggestedCategoryName: null,
    descriptionSuggestion: "Compra no mercado",
    items: [{ description: "Arroz", quantity: 1, unitPrice: 10, totalPrice: 10 }],
    itemsSum: 10,
    totalMismatch: null,
    extraction: { method: "PDF_TEXT", ocrConfidence: null, warnings: [], qrDetected: false, secondPass: false },
    accessKeyValid: false,
    ...overrides,
  }) as ReceiptImportPreview;

const httpError = (status: number, message: string, code?: string) =>
  throwError(() => ({ status, error: { statusCode: status, message, ...(code ? { code } : {}) } }));

describe("ImportsPageComponent — nota fiscal sem IA", () => {
  let fixture: ComponentFixture<ImportsPageComponent>;
  let api: {
    previewImport: jasmine.Spy;
    commitImport: jasmine.Spy;
    previewReceiptImport: jasmine.Spy;
    commitReceiptImport: jasmine.Spy;
    createTagGroup: jasmine.Spy;
    listReceiptHistory: jasmine.Spy;
    listCsvImportHistory: jasmine.Spy;
  };
  let toast: { success: jasmine.Spy; error: jasmine.Spy };

  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => (root().textContent ?? "").replace(/\s+/g, " ");
  const buttonWithText = (label: string) =>
    Array.from(root().querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === label,
    ) as HTMLButtonElement | undefined;
  const clickButton = (label: string) => {
    buttonWithText(label)!.click();
    fixture.detectChanges();
  };
  const fileOf = (name = "nota.jpg") => {
    const dt = new DataTransfer();
    dt.items.add(new File(["x"], name, { type: "image/jpeg" }));
    return dt.files;
  };

  /** Dispara o fluxo real de upload (o componente lê o input de arquivo pelo handler). */
  const uploadReceipt = () => {
    const component = fixture.componentInstance as unknown as {
      handleReceiptFile(event: Event): void;
    };
    component.handleReceiptFile({ target: { files: fileOf(), value: "" } } as unknown as Event);
    fixture.detectChanges();
  };

  const selectGroupAndUpload = () => {
    clickButton("Mercado");
    uploadReceipt();
  };

  const create = () => {
    fixture = TestBed.createComponent(ImportsPageComponent);
    fixture.detectChanges();
  };

  const userWith = (overrides: Record<string, unknown> = {}) => ({
    id: "u1",
    name: "Teste",
    preferredCurrency: "BRL",
    financeCategories: [],
    tagGroups: [{ id: "g1", name: "Mercado", color: null, isDefault: false, sortOrder: 0 }],
    privacyNoticeAcceptedAt: null,
    aiAssistantEnabled: false,
    aiAssistantConsentAt: null,
    ...overrides,
  });

  beforeEach(() => {
    api = {
      previewImport: jasmine.createSpy("previewImport"),
      commitImport: jasmine.createSpy("commitImport"),
      previewReceiptImport: jasmine.createSpy("previewReceiptImport").and.returnValue(of(receipt())),
      commitReceiptImport: jasmine.createSpy("commitReceiptImport").and.returnValue(of({ success: true })),
      createTagGroup: jasmine.createSpy("createTagGroup"),
      listReceiptHistory: jasmine.createSpy("listReceiptHistory").and.returnValue(of([])),
      listCsvImportHistory: jasmine.createSpy("listCsvImportHistory").and.returnValue(of([])),
    };
    toast = { success: jasmine.createSpy("success"), error: jasmine.createSpy("error") };

    TestBed.configureTestingModule({
      imports: [ImportsPageComponent],
      providers: [
        provideRouter([]),
        { provide: LOCALE_ID, useValue: "pt-BR" },
        { provide: LifeApiService, useValue: api },
        { provide: ToastService, useValue: toast },
        {
          provide: AuthService,
          useValue: { currentUser: signal(userWith()), loadMe: () => of(null) },
        },
      ],
    });
  });

  it("upload de nota aparece sem consentimento de IA e sem o aviso de IA desativada", () => {
    create();
    clickButton("Mercado");

    expect(root().querySelector('input[type="file"][accept^="image"]')).not.toBeNull();
    expect(text()).not.toContain("IA externa desativada");
    expect(text()).not.toContain("IA indisponível");
  });

  it("divergência de soma mostra o aviso com os dois valores e mantém o botão habilitado", () => {
    api.previewReceiptImport.and.returnValue(
      of(
        receipt({
          items: [{ description: "Arroz", quantity: 1, unitPrice: 8, totalPrice: 8 }],
          itemsSum: 8,
          totalMismatch: { itemsSum: 8, total: 10, difference: 2 },
        }),
      ),
    );
    create();
    selectGroupAndUpload();

    expect(text()).toContain("A soma dos itens (R$ 8,00) é diferente do total da nota (R$ 10,00).");
    expect(buttonWithText("Confirmar importação")!.disabled).toBeFalse();
  });

  it("editar item até a soma bater esconde o aviso de divergência", () => {
    api.previewReceiptImport.and.returnValue(
      of(
        receipt({
          items: [{ description: "Arroz", quantity: 1, unitPrice: 8, totalPrice: 8 }],
          itemsSum: 8,
          totalMismatch: { itemsSum: 8, total: 10, difference: 2 },
        }),
      ),
    );
    create();
    selectGroupAndUpload();
    expect(text()).toContain("é diferente do total da nota");

    clickButton("Ajustar");
    const itemTotal = root().querySelectorAll<HTMLInputElement>(".proto-list-item .proto-form-grid input")[3];
    itemTotal.value = "10";
    itemTotal.dispatchEvent(new Event("input"));
    fixture.detectChanges();

    expect(text()).not.toContain("é diferente do total da nota");
  });

  it("lista extraction.warnings e mostra confiança baixa", () => {
    api.previewReceiptImport.and.returnValue(
      of(
        receipt({
          confidence: "low",
          extraction: {
            method: "OCR",
            ocrConfidence: 40,
            warnings: ["Data não encontrada no texto.", "Total lido com baixa confiança."],
            qrDetected: false,
            secondPass: true,
          },
        }),
      ),
    );
    create();
    selectGroupAndUpload();

    expect(text()).toContain("Data não encontrada no texto.");
    expect(text()).toContain("Total lido com baixa confiança.");
    expect(text()).toContain("Leitura incerta, confira cada linha.");
  });

  it("confiança alta não mostra aviso extra de leitura incerta", () => {
    create();
    selectGroupAndUpload();

    expect(text()).not.toContain("Leitura incerta, confira cada linha.");
  });

  it("possibleDuplicate mostra a caixa e o botão Importar mesmo assim, que envia acknowledgeDuplicate", () => {
    api.previewReceiptImport.and.returnValue(
      of(
        receipt({
          possibleDuplicate: true,
          duplicateTransactionDescription: "Mercado Teste, 15/11, R$ 10,00",
        }),
      ),
    );
    create();
    selectGroupAndUpload();

    expect(text()).toContain("Parece que você já lançou esta compra");
    expect(text()).toContain("Mercado Teste, 15/11, R$ 10,00");
    expect(buttonWithText("Importar mesmo assim")).toBeDefined();

    clickButton("Importar mesmo assim");

    expect(api.commitReceiptImport).toHaveBeenCalledTimes(1);
    expect(api.commitReceiptImport.calls.mostRecent().args[0].acknowledgeDuplicate).toBeTrue();
  });

  it("sem duplicata o commit não leva acknowledgeDuplicate verdadeiro", () => {
    create();
    selectGroupAndUpload();
    clickButton("Confirmar importação");

    expect(api.commitReceiptImport).toHaveBeenCalledTimes(1);
    const payload = api.commitReceiptImport.calls.mostRecent().args[0];
    expect(payload.acknowledgeDuplicate).not.toBeTrue();
  });

  it("commit com 409 RECEIPT_DUPLICATE_UNCONFIRMED abre a caixa sem toast de erro", () => {
    api.commitReceiptImport.and.returnValue(
      httpError(409, "Parece que você já lançou esta compra. Confirme para importar mesmo assim.", "RECEIPT_DUPLICATE_UNCONFIRMED"),
    );
    create();
    selectGroupAndUpload();
    clickButton("Confirmar importação");

    expect(text()).toContain("Parece que você já lançou esta compra");
    expect(buttonWithText("Importar mesmo assim")).toBeDefined();
    expect(toast.error).not.toHaveBeenCalled();
    expect(root().querySelector(".import-error")).toBeNull();
  });

  for (const [status, code, message] of [
    [422, "RECEIPT_UNREADABLE", "Não há total confiável nesta nota. Lance o gasto pelo chat ou pela tela de Finanças."],
    [429, "RECEIPT_BUSY", "Muitas leituras ao mesmo tempo. Tente em instantes."],
    [400, undefined, "Formato HEIC não é lido. Envie a foto em JPG ou PNG, ou tire um print da nota."],
  ] as const) {
    it(`preview com ${status} mostra a mensagem do servidor e limpa a prévia anterior`, () => {
      create();
      selectGroupAndUpload();
      expect(text()).toContain("Mercado Teste");

      api.previewReceiptImport.and.returnValue(httpError(status, message, code));
      uploadReceipt();

      expect(root().querySelector(".import-error")?.textContent?.trim()).toBe(message);
      expect(text()).not.toContain("Mercado Teste");
      expect(buttonWithText("Confirmar importação")).toBeUndefined();
    });
  }

  it("preview sem mensagem do servidor mostra o texto padrão", () => {
    api.previewReceiptImport.and.returnValue(throwError(() => ({ status: 500, error: {} })));
    create();
    selectGroupAndUpload();

    expect(root().querySelector(".import-error")?.textContent?.trim()).toBe(
      "Não consegui ler esta nota. Tente outra foto ou lance o gasto pelo chat.",
    );
  });

  it("nota antiga sem extraction, itemsSum, totalMismatch e accessKeyValid renderiza sem erro", () => {
    const full = receipt();
    const old = { ...full } as Partial<ReceiptImportPreview>;
    delete old.extraction;
    delete old.itemsSum;
    delete old.totalMismatch;
    delete old.accessKeyValid;
    api.previewReceiptImport.and.returnValue(of(old as ReceiptImportPreview));
    create();
    selectGroupAndUpload();

    expect(text()).toContain("Mercado Teste");
    expect(text()).not.toContain("é diferente do total da nota");
    expect(text()).not.toContain("Leitura incerta");
  });

  it("título Resumo da compra aparece quando há sinais", () => {
    api.previewReceiptImport.and.returnValue(
      of(receipt({ spendingSignals: ["Compra recorrente de alimentos"] })),
    );
    create();
    selectGroupAndUpload();

    expect(text()).toContain("Resumo da compra");
    expect(text()).not.toContain("Leitura Selah da compra");
  });
});
