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

  it("divergência de soma aparece uma vez só: o aviso genérico do backend não repete a caixa com valores", () => {
    const mismatchText = "A soma dos itens é diferente do total da nota. Confira cada linha.";
    api.previewReceiptImport.and.returnValue(
      of(
        receipt({
          items: [{ description: "Arroz", quantity: 1, unitPrice: 8, totalPrice: 8 }],
          itemsSum: 8,
          totalMismatch: { itemsSum: 8, total: 10, difference: 2 },
          notes: [mismatchText],
          extraction: {
            method: "OCR",
            ocrConfidence: 40,
            warnings: [mismatchText, "Data não encontrada no texto."],
            qrDetected: false,
            secondPass: true,
          },
        }),
      ),
    );
    create();
    selectGroupAndUpload();

    expect(text()).toContain("A soma dos itens (R$ 8,00) é diferente do total da nota (R$ 10,00).");
    expect(text()).not.toContain("Confira cada linha.");
    expect(text()).toContain("Data não encontrada no texto.");
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

  describe("revisão 4b", () => {
    const editItemTotal = (value: string) => {
      clickButton("Ajustar");
      const itemTotal = root().querySelectorAll<HTMLInputElement>(".proto-list-item .proto-form-grid input")[3];
      itemTotal.value = value;
      itemTotal.dispatchEvent(new Event("input"));
      fixture.detectChanges();
    };
    const totalInput = () => root().querySelectorAll<HTMLInputElement>(".proto-form-grid input[type=number]")[0];

    it("prévia sem divergência: editar o total de um item cria o aviso com os valores locais", () => {
      create();
      selectGroupAndUpload();
      expect(text()).not.toContain("é diferente do total da nota");

      editItemTotal("7");

      expect(text()).toContain("A soma dos itens (R$ 7,00) é diferente do total da nota (R$ 10,00).");
    });

    it("prévia sem divergência: editar o total da nota cria o aviso, e voltar o valor o esconde", () => {
      create();
      selectGroupAndUpload();

      totalInput().value = "12.5";
      totalInput().dispatchEvent(new Event("input"));
      fixture.detectChanges();
      expect(text()).toContain("A soma dos itens (R$ 10,00) é diferente do total da nota (R$ 12,50).");

      totalInput().value = "10";
      totalInput().dispatchEvent(new Event("input"));
      fixture.detectChanges();
      expect(text()).not.toContain("é diferente do total da nota");
    });

    it("diferença de um centavo não gera aviso, dois centavos geram", () => {
      api.previewReceiptImport.and.returnValue(
        of(receipt({ items: [{ description: "Arroz", quantity: 1, unitPrice: 0.3, totalPrice: 0.3 }, { description: "Feijão", quantity: 1, unitPrice: 0.6, totalPrice: 0.6 }], totalAmount: 0.91 })),
      );
      create();
      selectGroupAndUpload();
      expect(text()).not.toContain("é diferente do total da nota");

      totalInput().value = "0.92";
      totalInput().dispatchEvent(new Event("input"));
      fixture.detectChanges();
      expect(text()).toContain("é diferente do total da nota");
    });

    it("com a caixa aberta pelo 409, o primeiro clique não leva acknowledgeDuplicate e o segundo leva", () => {
      api.commitReceiptImport.and.returnValues(
        httpError(409, "Parece que você já lançou esta compra.", "RECEIPT_DUPLICATE_UNCONFIRMED"),
        of({ success: true }),
      );
      create();
      selectGroupAndUpload();

      clickButton("Confirmar importação");
      expect(api.commitReceiptImport.calls.argsFor(0)[0].acknowledgeDuplicate).toBeUndefined();
      expect(toast.success).not.toHaveBeenCalled();

      clickButton("Importar mesmo assim");
      expect(api.commitReceiptImport).toHaveBeenCalledTimes(2);
      expect(api.commitReceiptImport.calls.argsFor(1)[0].acknowledgeDuplicate).toBeTrue();
      expect(toast.success).toHaveBeenCalledTimes(1);
    });

    it("nova prévia sem duplicata fecha a caixa aberta por um 409 anterior", () => {
      api.commitReceiptImport.and.returnValue(httpError(409, "dup", "RECEIPT_DUPLICATE_UNCONFIRMED"));
      create();
      selectGroupAndUpload();
      clickButton("Confirmar importação");
      expect(text()).toContain("Parece que você já lançou esta compra");

      api.previewReceiptImport.and.returnValue(of(receipt({ merchantName: "Outro Mercado" })));
      // volta ao upload: sem prévia, o usuário envia outra nota
      (fixture.componentInstance as unknown as { receiptPreview: { set(v: null): void } }).receiptPreview.set(null);
      fixture.detectChanges();
      uploadReceipt();

      expect(text()).toContain("Outro Mercado");
      expect(text()).not.toContain("Parece que você já lançou esta compra");
      expect(buttonWithText("Confirmar importação")).toBeDefined();
    });

    it("o 409 traz a caixa de duplicata para a tela antes do segundo clique", async () => {
      const scroll = spyOn(HTMLElement.prototype, "scrollIntoView");
      api.commitReceiptImport.and.returnValue(httpError(409, "dup", "RECEIPT_DUPLICATE_UNCONFIRMED"));
      create();
      selectGroupAndUpload();
      await fixture.whenStable();
      expect(scroll).not.toHaveBeenCalled();

      clickButton("Confirmar importação");
      await fixture.whenStable();

      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll.calls.mostRecent().object).toBe(root().querySelector("[role='alert']") as HTMLElement);
    });

    it("409 não deixa receiptError antigo na tela", () => {
      api.commitReceiptImport.and.returnValues(
        httpError(500, "Falha no servidor.", undefined),
        httpError(409, "dup", "RECEIPT_DUPLICATE_UNCONFIRMED"),
      );
      create();
      selectGroupAndUpload();

      clickButton("Confirmar importação");
      expect(root().querySelector(".import-error")?.textContent?.trim()).toBe("Falha no servidor.");
      expect(toast.error).toHaveBeenCalledWith("Falha no servidor.");

      clickButton("Confirmar importação");
      expect(root().querySelector(".import-error")).toBeNull();
      expect(toast.error).toHaveBeenCalledTimes(1);
    });

    it("erro de commit sem mensagem usa o mesmo texto, com acento, na tela e no toast", () => {
      api.commitReceiptImport.and.returnValue(throwError(() => ({ status: 0, error: {} })));
      create();
      selectGroupAndUpload();
      clickButton("Confirmar importação");

      const message = "Não foi possível registrar a compra no financeiro.";
      expect(root().querySelector(".import-error")?.textContent?.trim()).toBe(message);
      expect(toast.error).toHaveBeenCalledWith(message);
    });

    for (const [label, failure] of [
      ["400", { status: 400, error: { message: "Formato inválido." } }],
      ["409", { status: 409, error: { code: "RECEIPT_DUPLICATE_UNCONFIRMED", message: "dup" } }],
      ["422", { status: 422, error: { code: "RECEIPT_UNREADABLE", message: "Sem total." } }],
      ["429", { status: 429, error: { code: "RECEIPT_BUSY", message: "Ocupado." } }],
      ["rede caída", { status: 0, error: new ProgressEvent("error") }],
    ] as const) {
      it(`preview com ${label} devolve o botão de envio ao normal e deixa reenviar`, () => {
        api.previewReceiptImport.and.returnValue(throwError(() => failure));
        create();
        selectGroupAndUpload();

        const sendButton = buttonWithText("Selecionar imagem ou PDF")!;
        expect(sendButton).toBeDefined();
        expect(sendButton.disabled).toBeFalse();
        expect(text()).not.toContain("Lendo nota...");
      });
    }

    it("commit com erro devolve o botão de confirmar ao normal", () => {
      api.commitReceiptImport.and.returnValue(httpError(429, "Ocupado."));
      create();
      selectGroupAndUpload();
      clickButton("Confirmar importação");

      expect(buttonWithText("Confirmar importação")!.disabled).toBeFalse();
      expect(text()).not.toContain("Registrando...");
    });

    it("limpa o campo de arquivo ao enviar, para poder reenviar a mesma foto", () => {
      create();
      clickButton("Mercado");
      const component = fixture.componentInstance as unknown as { handleReceiptFile(event: Event): void };
      const input = { files: fileOf(), value: "C:\\fakepath\\nota.jpg" };

      component.handleReceiptFile({ target: input } as unknown as Event);

      expect(input.value).toBe("");
    });

    it("limpa o campo de arquivo mesmo quando falta escolher o grupo", () => {
      create();
      const component = fixture.componentInstance as unknown as { handleReceiptFile(event: Event): void };
      const input = { files: fileOf(), value: "C:\\fakepath\\nota.jpg" };

      component.handleReceiptFile({ target: input } as unknown as Event);
      fixture.detectChanges();

      expect(input.value).toBe("");
      expect(api.previewReceiptImport).not.toHaveBeenCalled();
      expect(root().querySelector(".import-error")?.textContent).toContain("Escolha um grupo");
    });

    it("avisos de extraction.warnings não aparecem duas vezes quando notes repete o texto", () => {
      api.previewReceiptImport.and.returnValue(
        of(
          receipt({
            notes: ["Data não encontrada no texto.", "Aviso só em notes."],
            extraction: { method: "OCR", ocrConfidence: 80, warnings: ["Data não encontrada no texto."], qrDetected: false, secondPass: false },
          }),
        ),
      );
      create();
      selectGroupAndUpload();

      expect(text().split("Data não encontrada no texto.").length - 1).toBe(1);
      expect(text()).toContain("Aviso só em notes.");
    });

    it("quebra por categoria sozinha (sem IA) abre o Resumo da compra", () => {
      api.previewReceiptImport.and.returnValue(
        of(receipt({ categoryBreakdown: [{ label: "Mercearia", totalAmount: 10, itemCount: 1 }] })),
      );
      create();
      selectGroupAndUpload();

      expect(text()).toContain("Resumo da compra");
      expect(text()).toContain("Mercearia");
    });

    it("quantidade de peso aparece com vírgula, não como milhar", () => {
      api.previewReceiptImport.and.returnValue(
        of(receipt({ items: [{ description: "Frango", quantity: 1.331, unitPrice: 17.5, totalPrice: 23.29 }], totalAmount: 23.29 })),
      );
      create();
      selectGroupAndUpload();

      expect(text()).toContain("Qtd. 1,331");
      expect(text()).not.toContain("Qtd. 1.331");
    });

    it("rótulo 'Sem sugestao' do backend aparece com acento", () => {
      api.previewReceiptImport.and.returnValue(
        of(receipt({ categoryBreakdown: [{ label: "Sem sugestao", totalAmount: 10, itemCount: 1 }] })),
      );
      create();
      selectGroupAndUpload();

      expect(text()).toContain("Sem sugestão");
      expect(text()).not.toContain("Sem sugestao");
    });

    it("sem sinais nem quebra por categoria o Resumo da compra fica escondido", () => {
      create();
      selectGroupAndUpload();

      expect(text()).not.toContain("Resumo da compra");
    });

    it("texto da nota com HTML é mostrado como texto, sem criar elementos", () => {
      api.previewReceiptImport.and.returnValue(
        of(receipt({ merchantName: "<img src=x onerror=alert(1)>", notes: ["<b>negrito</b>"] })),
      );
      create();
      selectGroupAndUpload();

      expect(root().querySelector("img[src='x']")).toBeNull();
      expect(root().querySelector("b")).toBeNull();
      expect(text()).toContain("<b>negrito</b>");
    });

    it("avisos de divergência e duplicata usam role alert", () => {
      api.previewReceiptImport.and.returnValue(
        of(
          receipt({
            possibleDuplicate: true,
            items: [{ description: "Arroz", quantity: 1, unitPrice: 8, totalPrice: 8 }],
            totalMismatch: { itemsSum: 8, total: 10, difference: 2 },
          }),
        ),
      );
      create();
      selectGroupAndUpload();

      expect(root().querySelectorAll("[role='alert']").length).toBe(2);
    });

    it("não grava a nota em localStorage nem escreve no console", () => {
      const setItem = spyOn(Storage.prototype, "setItem").and.callThrough();
      const log = spyOn(console, "log");
      create();
      selectGroupAndUpload();
      clickButton("Confirmar importação");

      expect(setItem).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    });
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
