import { registerLocaleData } from "@angular/common";
import localePt from "@angular/common/locales/pt";
import { LOCALE_ID, WritableSignal, signal } from "@angular/core";
import { ComponentFixture, TestBed, fakeAsync, tick } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { Subject, of, throwError } from "rxjs";
import {
  ConversationReply,
  ConversationSessionView,
  DraftView,
} from "../../../core/models/conversation.models";
import { AuthService } from "../../../core/services/auth.service";
import { ConversationApiService } from "../../../core/services/conversation-api.service";
import { LifeApiService } from "../../../core/services/life-api.service";
import { NativeStorageService } from "../../../core/services/native-storage.service";
import { AssistantPageComponent } from "./assistant-page.component";

// O app registra o pt-BR no main.ts; o ambiente de teste não passa por lá.
registerLocaleData(localePt);

/** Rascunho de lançamento. Sem `rows` no override, as linhas saem dos campos (como o backend faz). */
const draft = (overrides: Partial<DraftView> = {}): DraftView => {
  const base = {
    draftId: "draft-1",
    draftVersion: 1,
    kind: "TRANSACTION",
    title: "Lançamento",
    type: "EXPENSE",
    amount: "R$ 50,00",
    description: "mercado",
    category: "Alimentação",
    date: "2026-11-15",
    paymentMethod: null,
    pendingField: null,
    ...overrides,
  } as DraftView;

  return {
    ...base,
    rows: overrides.rows ?? [
      { label: "Valor", value: base.amount ?? "a informar" },
      { label: "Descrição", value: base.description ?? "não informado" },
      { label: "Categoria", value: base.category ?? "não informado" },
      { label: "Data", value: "15/11/2026" },
      { label: "Forma de pagamento", value: "não informado" },
    ],
  };
};

/** Formato de backend antigo: sem kind, title e rows. */
const legacyDraft = (overrides: Partial<DraftView> = {}): DraftView => {
  const { rows: _rows, kind: _kind, title: _title, ...rest } = draft(overrides);
  return rest as DraftView;
};

const confirmReply = (): ConversationReply => ({
  kind: "CONFIRM_DRAFT",
  state: "AWAITING_CONFIRMATION",
  text: "Confirma o gasto?",
  draft: draft(),
  quickReplies: ["confirmar", "cancelar"],
});

const selahReply = () =>
  ({
    answer: "Resposta do Selah",
    highlights: [],
    suggestedActions: [],
    actions: [],
    proactiveSignals: [],
    simulations: [],
    continuity: { historyCount: 0, memorySummary: null, nextQuestion: null, followUpPrompt: null, originModule: null },
    explainability: { reasoning: [], evidence: [], confidenceReason: "" },
    confidence: "medium",
    disclaimer: null,
    generatedAt: "2026-11-15T12:00:00.000Z",
  }) as never;

describe("AssistantPageComponent — assistente manual", () => {
  let fixture: ComponentFixture<AssistantPageComponent>;
  let api: {
    offlineMode: WritableSignal<boolean>;
    getAssistantPulse: jasmine.Spy;
    listAssistantHistory: jasmine.Spy;
    askAssistant: jasmine.Spy;
    saveAssistantTurn: jasmine.Spy;
  };
  let conversation: {
    sendMessage: jasmine.Spy;
    confirmDraft: jasmine.Spy;
    cancelDraft: jasmine.Spy;
    getSession: jasmine.Spy;
  };
  let storage: { getItem: jasmine.Spy; setItem: jasmine.Spy };

  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => root().textContent ?? "";
  const buttonWithText = (label: string) =>
    Array.from(root().querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === label,
    ) as HTMLButtonElement | undefined;

  const clickCommand = (label: string) => {
    buttonWithText(label)!.click();
    fixture.detectChanges();
  };

  const typeAndSend = (value: string) => {
    const textarea = root().querySelector<HTMLTextAreaElement>("#assistant-question")!;
    textarea.value = value;
    textarea.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    root().querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    fixture.detectChanges();
  };

  const create = () => {
    fixture = TestBed.createComponent(AssistantPageComponent);
    fixture.detectChanges();
  };

  beforeEach(() => {
    api = {
      offlineMode: signal(false),
      getAssistantPulse: jasmine.createSpy("getAssistantPulse").and.returnValue(of(null)),
      listAssistantHistory: jasmine.createSpy("listAssistantHistory").and.returnValue(of([])),
      askAssistant: jasmine.createSpy("askAssistant").and.returnValue(of(selahReply())),
      saveAssistantTurn: jasmine.createSpy("saveAssistantTurn").and.returnValue(of({})),
    };

    conversation = {
      sendMessage: jasmine.createSpy("sendMessage"),
      confirmDraft: jasmine.createSpy("confirmDraft"),
      cancelDraft: jasmine.createSpy("cancelDraft"),
      getSession: jasmine.createSpy("getSession"),
    };
    conversation.sendMessage.and.returnValue(of({ kind: "HELP", state: "IDLE", text: "ajuda", unrecognized: true }));
    conversation.getSession.and.returnValue(of<ConversationSessionView>({ state: "IDLE" }));

    storage = {
      getItem: jasmine.createSpy("getItem").and.returnValue(null),
      setItem: jasmine.createSpy("setItem"),
    };

    const user = {
      id: "u1",
      name: "Teste",
      preferredCurrency: "BRL",
      privacyNoticeAcceptedAt: "2026-11-01T00:00:00.000Z",
      aiAssistantEnabled: true,
      aiAssistantConsentAt: "2026-11-01T00:00:00.000Z",
    };

    TestBed.configureTestingModule({
      imports: [AssistantPageComponent],
      providers: [
        provideRouter([]),
        { provide: LOCALE_ID, useValue: "pt-BR" },
        { provide: LifeApiService, useValue: api },
        { provide: ConversationApiService, useValue: conversation },
        { provide: NativeStorageService, useValue: storage },
        { provide: AuthService, useValue: { currentUser: signal(user), updateStoredUser: () => undefined } },
      ],
    });
  });

  it("texto que o motor não reconhece vai ao Selah e não mostra cartão manual", () => {
    create();

    typeAndSend("Como estou hoje?");

    expect(conversation.sendMessage).toHaveBeenCalledTimes(1);
    expect(api.askAssistant).toHaveBeenCalledTimes(1);
    expect(text()).not.toContain("Assistente manual");
  });

  it("resposta normal do motor mostra o cartão e não chama o Selah", () => {
    conversation.sendMessage.and.returnValue(of(confirmReply()));
    create();

    clickCommand("50 mercado");

    expect(api.askAssistant).not.toHaveBeenCalled();
    expect(text()).toContain("Confira os dados antes de confirmar");
    expect(text()).not.toContain("Confirma o gasto?");
    expect(text()).toContain("R$ 50,00");
    expect(text()).toContain("Alimentação");
    expect(text()).toContain("15/11/2026");
    expect(buttonWithText("Confirmar")).toBeDefined();
    expect(buttonWithText("Cancelar")).toBeDefined();
  });

  it("offline não tenta o manual e segue para o Selah", () => {
    api.offlineMode.set(true);
    create();

    typeAndSend("50 mercado");

    expect(conversation.sendMessage).not.toHaveBeenCalled();
    expect(api.askAssistant).toHaveBeenCalledTimes(1);
  });

  it("confirmar com duplo clique chama /confirm uma vez", () => {
    const pending = new Subject<ConversationReply>();
    conversation.sendMessage.and.returnValue(of(confirmReply()));
    conversation.confirmDraft.and.returnValue(pending.asObservable());
    create();
    clickCommand("50 mercado");

    const confirm = buttonWithText("Confirmar")!;
    confirm.click();
    confirm.click();
    fixture.detectChanges();

    expect(conversation.confirmDraft).toHaveBeenCalledTimes(1);
    expect(conversation.confirmDraft).toHaveBeenCalledWith("draft-1", 1);
  });

  it("mesmo texto reenviado após falha de rede reutiliza o messageId", () => {
    conversation.sendMessage.and.returnValues(
      throwError(() => ({ status: 0 })),
      of({ kind: "CANCELLED", state: "IDLE", text: "Cancelado." }),
      of({ kind: "CANCELLED", state: "IDLE", text: "Cancelado." }),
    );
    create();

    clickCommand("50 mercado");
    expect(text()).toContain("Não foi possível enviar sua mensagem agora.");

    buttonWithText("Tentar de novo")!.click();
    fixture.detectChanges();

    const firstId = conversation.sendMessage.calls.argsFor(0)[0];
    const retryId = conversation.sendMessage.calls.argsFor(1)[0];
    expect(retryId).toBe(firstId);

    // Após sucesso, um envio novo do mesmo texto gera outro messageId.
    clickCommand("50 mercado");
    expect(conversation.sendMessage.calls.argsFor(2)[0]).not.toBe(firstId);
  });

  it("sem crypto.randomUUID (contexto não seguro) ainda gera um UUID v4 válido", () => {
    const original = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      conversation.sendMessage.and.returnValue(of({ kind: "CANCELLED", state: "IDLE", text: "Cancelado." }));
      create();

      clickCommand("50 mercado");

      expect(conversation.sendMessage.calls.argsFor(0)[0]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: original, configurable: true });
    }
  });

  it("erro do manual não cai no Selah", () => {
    conversation.sendMessage.and.returnValue(throwError(() => ({ status: 500 })));
    create();

    clickCommand("50 mercado");

    expect(api.askAssistant).not.toHaveBeenCalled();
    expect(text()).toContain("Não foi possível enviar sua mensagem agora.");
  });

  it("turno manual não é gravado em localStorage nem em saveAssistantTurn", () => {
    conversation.sendMessage.and.returnValue(of(confirmReply()));
    const rawSetItem = spyOn(localStorage, "setItem");
    create();

    clickCommand("50 mercado");

    expect(text()).toContain("R$ 50,00");
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(rawSetItem).not.toHaveBeenCalled();
    expect(api.saveAssistantTurn).not.toHaveBeenCalled();
  });

  it("confirmar com 404 mostra aviso e atualiza a sessão", () => {
    conversation.sendMessage.and.returnValue(of(confirmReply()));
    conversation.confirmDraft.and.returnValue(throwError(() => ({ status: 404 })));
    create();
    clickCommand("50 mercado");
    conversation.getSession.calls.reset();

    buttonWithText("Confirmar")!.click();
    fixture.detectChanges();

    expect(text()).toContain("Rascunho não encontrado ou já usado.");
    expect(conversation.getSession).toHaveBeenCalledTimes(1);
  });

  it("mostra 'Consultando seus dados…' só depois de 250 ms", fakeAsync(() => {
    const pending = new Subject<ConversationReply>();
    conversation.sendMessage.and.returnValue(pending.asObservable());
    create();

    clickCommand("50 mercado");
    tick(249);
    fixture.detectChanges();
    expect(text()).not.toContain("Consultando seus dados");

    tick(1);
    fixture.detectChanges();
    expect(text()).toContain("Consultando seus dados");

    pending.next({ kind: "CANCELLED", state: "IDLE", text: "Cancelado." });
    pending.complete();
    fixture.detectChanges();
    expect(text()).not.toContain("Consultando seus dados");
  }));

  it("ao abrir, restaura o rascunho em andamento com botões", () => {
    conversation.getSession.and.returnValue(
      of<ConversationSessionView>({ state: "AWAITING_CONFIRMATION", draft: draft() }),
    );
    create();

    expect(text()).toContain("Você tem um rascunho em andamento.");
    expect(buttonWithText("Confirmar")).toBeDefined();
  });

  it("ao abrir com rascunho sem valor, avisa que falta o valor e não mostra Confirmar", () => {
    conversation.getSession.and.returnValue(
      of<ConversationSessionView>({
        state: "COLLECTING_FIELDS",
        draft: draft({ pendingField: "amount", amount: "a informar" }),
      }),
    );
    create();

    expect(text()).toContain("Falta informar: valor.");
    expect(buttonWithText("Confirmar")).toBeUndefined();
  });

  it("com botões Confirmar e Cancelar, os atalhos de texto repetidos somem e os outros ficam", () => {
    conversation.sendMessage.and.returnValue(
      of({ ...confirmReply(), quickReplies: ["confirmar", "cancelar", "mudar categoria"] }),
    );
    create();

    clickCommand("50 mercado");

    expect(buttonWithText("confirmar")).toBeUndefined();
    expect(buttonWithText("cancelar")).toBeUndefined();
    expect(buttonWithText("mudar categoria")).toBeDefined();
    expect(buttonWithText("Confirmar")).toBeDefined();
  });

  it("atalhos de resposta aparecem quando não há botões de confirmação", () => {
    conversation.sendMessage.and.returnValue(
      of({ kind: "ASK_FIELD", state: "COLLECTING_FIELDS", text: "Qual categoria?", quickReplies: ["Mercado", "Lazer"] }),
    );
    create();

    clickCommand("50 mercado");

    expect(buttonWithText("Mercado")).toBeDefined();
    expect(buttonWithText("Lazer")).toBeDefined();
  });

  [{ foo: 1 }, null].forEach((bad) => {
    it(`resposta mal formada (${JSON.stringify(bad)}) vira erro claro, sem cartão vazio, e libera o envio`, () => {
      conversation.sendMessage.and.returnValue(of(bad as never));
      create();

      clickCommand("saldo");

      expect(text()).toContain("Resposta inesperada do servidor.");
      expect(text()).not.toContain("Assistente manual");
      expect(api.askAssistant).not.toHaveBeenCalled();
      expect(buttonWithText("saldo")!.disabled).toBeFalse();
    });
  });

  it("resposta ilegível ao enviar oferece reenvio com o mesmo messageId", () => {
    conversation.sendMessage.and.returnValues(
      of({ foo: 1 } as never),
      of({ kind: "INFO", state: "IDLE", text: "Saldo atual: R$ 800,00." }),
    );
    create();

    clickCommand("saldo");
    buttonWithText("Tentar de novo")!.click();
    fixture.detectChanges();

    expect(conversation.sendMessage.calls.argsFor(1)[0]).toBe(conversation.sendMessage.calls.argsFor(0)[0]);
    expect(text()).toContain("Saldo atual: R$ 800,00.");
  });

  it("confirmar com resposta ilegível não deixa cartão vazio: relê a sessão e mostra o rascunho real", () => {
    conversation.sendMessage.and.returnValue(of(confirmReply()));
    conversation.confirmDraft.and.returnValue(of({ foo: 1 } as never));
    conversation.getSession.and.returnValue(
      of<ConversationSessionView>({ state: "AWAITING_CONFIRMATION", draft: draft() }),
    );
    create();
    clickCommand("50 mercado");

    buttonWithText("Confirmar")!.click();
    fixture.detectChanges();

    expect(text()).toContain("Resposta inesperada do servidor.");
    expect(text()).toContain("R$ 50,00");
    expect(buttonWithText("Confirmar")).toBeDefined();
    expect(text()).not.toContain("Lançado");
  });

  it("429 mostra aviso de limite e oferece tentar de novo (sem cair no Selah)", () => {
    conversation.sendMessage.and.returnValue(throwError(() => ({ status: 429 })));
    create();

    clickCommand("saldo");

    expect(text()).toContain("Muitas mensagens em pouco tempo");
    expect(buttonWithText("Tentar de novo")).toBeDefined();
    expect(api.askAssistant).not.toHaveBeenCalled();
  });

  it("confirmar com 404 remove os botões na hora, mesmo se reler a sessão falhar", () => {
    conversation.sendMessage.and.returnValue(of(confirmReply()));
    conversation.confirmDraft.and.returnValue(throwError(() => ({ status: 404 })));
    create();
    clickCommand("50 mercado");
    conversation.getSession.and.returnValue(throwError(() => ({ status: 500 })));

    buttonWithText("Confirmar")!.click();
    fixture.detectChanges();

    expect(buttonWithText("Confirmar")).toBeUndefined();
    expect(buttonWithText("Cancelar")).toBeUndefined();
    expect(text()).toContain("Rascunho não encontrado ou já usado.");
  });

  it("leitura de sessão que chega depois de uma resposta mais nova não sobrescreve o cartão", () => {
    const lateSession = new Subject<ConversationSessionView>();
    conversation.getSession.and.returnValue(lateSession.asObservable());
    conversation.sendMessage.and.returnValue(
      of({ kind: "DONE", state: "IDLE", text: "Registrado: gasto de R$ 50,00 (mercado)." }),
    );
    create();

    clickCommand("50 mercado");
    // Sessão lida ANTES do lançamento ainda mostra o rascunho: não pode ressuscitar os botões.
    lateSession.next({ state: "AWAITING_CONFIRMATION", draft: draft() });
    fixture.detectChanges();

    expect(text()).toContain("Registrado: gasto de R$ 50,00");
    expect(buttonWithText("Confirmar")).toBeUndefined();
  });

  it("limpa o campo após resposta do manual, mas mantém o texto quando vai ao Selah", () => {
    conversation.sendMessage.and.returnValue(of({ kind: "ASK_FIELD", state: "COLLECTING_FIELDS", text: "Qual a descrição?" }));
    create();
    typeAndSend("50");
    expect(root().querySelector<HTMLTextAreaElement>("#assistant-question")!.value).toBe("");

    conversation.sendMessage.and.returnValue(of({ kind: "HELP", state: "IDLE", text: "x", unrecognized: true }));
    typeAndSend("Analise meus gastos do mês");
    expect(root().querySelector<HTMLTextAreaElement>("#assistant-question")!.value).toBe("Analise meus gastos do mês");
  });

  it("palavra longa sem espaço quebra dentro do cartão (sem estourar a largura)", () => {
    conversation.sendMessage.and.returnValue(
      of({ kind: "INFO", state: "IDLE", text: "y".repeat(120), draft: draft({ description: "x".repeat(120) }) }),
    );
    create();
    clickCommand("50 mercado");

    const host = root();
    host.style.width = "300px";
    host.style.display = "block";
    document.body.appendChild(host);
    const card = host.querySelector<HTMLElement>(".assistant-manual")!;
    const value = host.querySelector<HTMLElement>(".assistant-draft__row dd")!;

    expect(getComputedStyle(value).overflowWrap).toBe("anywhere");
    expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
  });

  it("texto com mais de 500 caracteres vai direto ao Selah, sem chamar o manual", () => {
    create();

    typeAndSend("a".repeat(501));

    expect(conversation.sendMessage).not.toHaveBeenCalled();
    expect(api.askAssistant).toHaveBeenCalledTimes(1);
  });

  describe("cartão do rascunho com rows (meta, aporte e lançamento)", () => {
    const goalDraft = (overrides: Partial<DraftView> = {}) =>
      draft({
        kind: "GOAL",
        title: "Meta",
        amount: null,
        description: null,
        category: null,
        date: null,
        rows: [
          { label: "Nome", value: "viagem" },
          { label: "Alvo", value: "R$ 3.000,00" },
        ],
        ...overrides,
      });

    const contributionDraft = (overrides: Partial<DraftView> = {}) =>
      draft({
        kind: "CONTRIBUTION",
        title: "Aporte",
        amount: null,
        description: null,
        category: null,
        date: null,
        rows: [
          { label: "Meta", value: "Viagem (R$ 1.200,00 de R$ 3.000,00)" },
          { label: "Valor", value: "R$ 200,00" },
          { label: "Data", value: "15/11/2026" },
        ],
        ...overrides,
      });

    const card = () => root().querySelector<HTMLElement>(".assistant-manual")!;
    const rowLabels = () =>
      Array.from(card().querySelectorAll(".assistant-draft__row dt")).map((dt) => dt.textContent?.trim());

    it("rascunho de meta mostra título Meta, as linhas de rows e os botões", () => {
      conversation.sendMessage.and.returnValue(
        of({ kind: "CONFIRM_DRAFT", state: "AWAITING_CONFIRMATION", text: "Confirma a meta?", draft: goalDraft(), quickReplies: ["confirmar", "cancelar"] }),
      );
      create();

      typeAndSend("criar meta viagem 3 mil");

      expect(card().querySelector(".assistant-draft__title")?.textContent?.trim()).toBe("Meta");
      expect(rowLabels()).toEqual(["Nome", "Alvo"]);
      expect(text()).toContain("R$ 3.000,00");
      expect(buttonWithText("Confirmar")).toBeDefined();
      expect(buttonWithText("Cancelar")).toBeDefined();
    });

    it("rascunho de aporte mostra título Aporte e as três linhas", () => {
      conversation.sendMessage.and.returnValue(
        of({ kind: "CONFIRM_DRAFT", state: "AWAITING_CONFIRMATION", text: "Confirma o aporte?", draft: contributionDraft(), quickReplies: [] }),
      );
      create();

      typeAndSend("guardar 200 na viagem");

      expect(card().querySelector(".assistant-draft__title")?.textContent?.trim()).toBe("Aporte");
      expect(rowLabels()).toEqual(["Meta", "Valor", "Data"]);
      expect(text()).toContain("Viagem (R$ 1.200,00 de R$ 3.000,00)");
    });

    it("lançamento com rows mostra só as linhas de rows, sem duplicar", () => {
      conversation.sendMessage.and.returnValue(of(confirmReply()));
      create();

      typeAndSend("50 mercado");

      expect(card().querySelector(".assistant-draft__title")?.textContent?.trim()).toBe("Lançamento");
      expect(rowLabels()).toEqual(["Valor", "Descrição", "Categoria", "Data", "Forma de pagamento"]);
      expect(card().querySelectorAll(".assistant-draft__row").length).toBe(5);
    });

    it("aviso de conclusão e data futura nas rows ficam visíveis antes de confirmar e ao restaurar", () => {
      const rows = [...contributionDraft().rows, { label: "Aviso", value: "Este aporte conclui a meta." }];
      conversation.sendMessage.and.returnValue(of({ ...confirmReply(), draft: contributionDraft({ rows }) }));
      create();
      typeAndSend("guardar 1800 na viagem");
      expect(card().textContent).toContain("Este aporte conclui a meta.");
      expect(buttonWithText("Confirmar")).toBeDefined();
      fixture.destroy();
      conversation.getSession.and.returnValue(of({ state: "AWAITING_CONFIRMATION", draft: draft({ rows: [
        { label: "Data", value: "20/12/2026" }, { label: "Aviso", value: "Este lançamento tem data futura." },
      ] }) }));
      create();
      expect(card().textContent).toContain("Este lançamento tem data futura.");
      expect(buttonWithText("Confirmar")).toBeDefined();
    });

    it("resposta sem rows (formato antigo) continua desenhando os campos antigos, sem título", () => {
      conversation.sendMessage.and.returnValue(of({ ...confirmReply(), draft: legacyDraft() }));
      create();

      typeAndSend("50 mercado");

      expect(card().querySelector(".assistant-draft__title")).toBeNull();
      expect(rowLabels()).toEqual(["Valor", "Descrição", "Categoria", "Data"]);
      expect(text()).toContain("15/11/2026");
    });

    it("formato antigo com amount e date nulos não mostra 'null'", () => {
      conversation.sendMessage.and.returnValue(
        of({ ...confirmReply(), draft: legacyDraft({ amount: null, date: null }) }),
      );
      create();

      typeAndSend("50 mercado");

      expect(card().textContent).not.toContain("null");
      expect(rowLabels()).toEqual(["Descrição", "Categoria"]);
    });

    it("ao restaurar rascunho de meta sem alvo, avisa 'Falta informar: valor-alvo.' e não mostra Confirmar", () => {
      conversation.getSession.and.returnValue(
        of<ConversationSessionView>({
          state: "COLLECTING_FIELDS",
          draft: goalDraft({
            pendingField: "target",
            rows: [
              { label: "Nome", value: "viagem" },
              { label: "Alvo", value: "a informar" },
            ],
          }),
        }),
      );
      create();

      expect(text()).toContain("Falta informar: valor-alvo.");
      expect(buttonWithText("Confirmar")).toBeUndefined();
    });
  });

  describe("reservas e limite do cartão (item 3b2a)", () => {
    const envelopeRows = (overrides: Partial<Record<string, string>> = {}) => [
      { label: "Nome", value: overrides["Nome"] ?? "gasolina" },
      { label: "Valor mensal", value: overrides["Valor mensal"] ?? "R$ 400,00" },
      { label: "Início", value: overrides["Início"] ?? "11/2026 (UTC)" },
      {
        label: "Aviso",
        value:
          "A reserva recebe a provisão mensal do app. Isso não transfere dinheiro de uma conta bancária nem faz aporte em meta.",
      },
    ];

    const envelopeDraft = (overrides: Partial<DraftView> = {}) =>
      draft({
        kind: "ENVELOPE",
        title: "Reserva",
        amount: null,
        description: null,
        category: null,
        date: null,
        rows: envelopeRows(),
        ...overrides,
      });

    const limitRows = (extra: Array<{ label: string; value: string }> = [], atual = "R$ 2.000,00") => [
      { label: "Ciclo", value: "06/11/2026 a 05/12/2026" },
      { label: "Limite atual", value: atual },
      { label: "Novo limite", value: "R$ 5.000,00" },
      { label: "Aviso", value: "Este limite vale só para o ciclo mostrado." },
      ...extra,
    ];

    const limitDraft = (overrides: Partial<DraftView> = {}) =>
      draft({
        kind: "CREDIT_LIMIT",
        title: "Limite do cartão",
        amount: null,
        description: null,
        category: null,
        date: null,
        rows: limitRows(),
        ...overrides,
      });

    const card = () => root().querySelector<HTMLElement>(".assistant-manual")!;
    const rowLabels = () =>
      Array.from(card().querySelectorAll(".assistant-draft__row dt")).map((dt) => dt.textContent?.trim());
    const rowValues = () =>
      Array.from(card().querySelectorAll(".assistant-draft__row dd")).map((dd) => dd.textContent?.trim());

    const reserveConfirm = (): ConversationReply => ({
      kind: "CONFIRM_DRAFT",
      state: "AWAITING_CONFIRMATION",
      text: "Reserva gasolina: R$ 400,00 por mês, início em 11/2026 (UTC).",
      draft: envelopeDraft(),
      quickReplies: ["confirmar", "cancelar"],
    });

    const limitConfirm = (draftOverrides: Partial<DraftView> = {}): ConversationReply => ({
      kind: "CONFIRM_DRAFT",
      state: "AWAITING_CONFIRMATION",
      text: "Limite de R$ 5.000,00 para o ciclo com fechamento em 05/12/2026.",
      draft: limitDraft(draftOverrides),
      quickReplies: ["confirmar", "cancelar"],
    });

    it("reserva em coleta de nome restaurada mostra 'a informar', 'Falta informar: nome.' e nenhum Confirmar", () => {
      conversation.getSession.and.returnValue(
        of<ConversationSessionView>({
          state: "COLLECTING_FIELDS",
          draft: envelopeDraft({
            pendingField: "name",
            rows: envelopeRows({ Nome: "a informar" }),
          }),
        }),
      );
      create();

      expect(card().querySelector(".assistant-draft__title")?.textContent?.trim()).toBe("Reserva");
      expect(rowLabels()).toEqual(["Nome", "Valor mensal", "Início", "Aviso"]);
      expect(rowValues()[0]).toBe("a informar");
      expect(text()).toContain("Falta informar: nome.");
      expect(buttonWithText("Confirmar")).toBeUndefined();
    });

    it("reserva completa mostra título, nome, valor mensal, mês UTC e aviso de provisão, sem null nem campos de lançamento", () => {
      conversation.sendMessage.and.returnValue(of(reserveConfirm()));
      create();

      typeAndSend("criar reserva 400 gasolina");

      expect(card().querySelector(".assistant-draft__title")?.textContent?.trim()).toBe("Reserva");
      expect(rowLabels()).toEqual(["Nome", "Valor mensal", "Início", "Aviso"]);
      expect(text()).toContain("gasolina");
      expect(text()).toContain("R$ 400,00");
      expect(text()).toContain("11/2026 (UTC)");
      expect(text()).toContain("A reserva recebe a provisão mensal do app.");
      expect(card().textContent).not.toContain("null");
      expect(text()).not.toContain("Categoria");
      expect(text()).not.toContain("Forma de pagamento");
      expect(buttonWithText("Confirmar")).toBeDefined();
    });

    it("limite completo mostra ciclo, teto atual, novo teto e aviso de validade por ciclo", () => {
      conversation.sendMessage.and.returnValue(of(limitConfirm()));
      create();

      typeAndSend("definir limite do cartão 5000");

      expect(card().querySelector(".assistant-draft__title")?.textContent?.trim()).toBe("Limite do cartão");
      expect(rowLabels()).toEqual(["Ciclo", "Limite atual", "Novo limite", "Aviso"]);
      expect(rowValues()).toEqual([
        "06/11/2026 a 05/12/2026",
        "R$ 2.000,00",
        "R$ 5.000,00",
        "Este limite vale só para o ciclo mostrado.",
      ]);
      expect(text()).not.toContain("todas as formas de pagamento");
      expect(buttonWithText("Confirmar")).toBeDefined();
    });

    it("limite sem teto atual mostra 'não definido' e, com todas as formas, o segundo aviso", () => {
      conversation.sendMessage.and.returnValue(
        of(
          limitConfirm({
            rows: limitRows(
              [{ label: "Aviso", value: "Este ciclo considera todas as formas de pagamento." }],
              "não definido",
            ),
          }),
        ),
      );
      create();

      typeAndSend("definir limite do cartão 5000");

      expect(rowValues()).toContain("não definido");
      expect(rowLabels().filter((label) => label === "Aviso").length).toBe(2);
      expect(text()).toContain("Este limite vale só para o ciclo mostrado.");
      expect(text()).toContain("Este ciclo considera todas as formas de pagamento.");
    });

    it("confirmação com draftVersion maior substitui o cartão e o próximo Confirmar envia o novo id e versão", () => {
      conversation.sendMessage.and.returnValue(of(limitConfirm()));
      conversation.confirmDraft.and.returnValues(
        of<ConversationReply>({
          kind: "CONFIRM_DRAFT",
          state: "AWAITING_CONFIRMATION",
          text: "O ciclo ou o limite atual mudou. Confira os dados atualizados e confirme novamente.",
          draft: limitDraft({
            draftVersion: 2,
            rows: limitRows([], "não definido").concat([
              { label: "Atenção", value: "O ciclo ou o limite atual mudou. Confira os dados atualizados e confirme novamente." },
            ]),
          }),
          quickReplies: ["confirmar", "cancelar"],
        }),
        of<ConversationReply>({ kind: "DONE", state: "IDLE", text: "Limite definido.", data: {} }),
      );
      create();
      typeAndSend("definir limite do cartão 5000");

      buttonWithText("Confirmar")!.click();
      fixture.detectChanges();

      expect(conversation.confirmDraft).toHaveBeenCalledWith("draft-1", 1);
      expect(rowLabels()).toContain("Atenção");
      expect(text()).toContain("Confira os dados atualizados");

      buttonWithText("Confirmar")!.click();
      fixture.detectChanges();

      expect(conversation.confirmDraft.calls.count()).toBe(2);
      expect(conversation.confirmDraft.calls.argsFor(1)).toEqual(["draft-1", 2]);
    });

    it("atenção de revisão aparece ao restaurar a sessão", () => {
      conversation.getSession.and.returnValue(
        of<ConversationSessionView>({
          state: "AWAITING_CONFIRMATION",
          draft: limitDraft({
            draftVersion: 2,
            rows: [
              ...limitRows(),
              { label: "Atenção", value: "O ciclo ou o limite atual mudou. Confira os dados atualizados e confirme novamente." },
            ],
          }),
        }),
      );
      create();

      expect(text()).toContain("Você tem um rascunho em andamento.");
      expect(rowLabels()).toContain("Atenção");
      expect(buttonWithText("Confirmar")).toBeDefined();
    });

    it("DONE de limite com data vazia mostra sucesso sem depender de data.card", () => {
      conversation.sendMessage.and.returnValue(of(limitConfirm()));
      conversation.confirmDraft.and.returnValue(
        of<ConversationReply>({
          kind: "DONE",
          state: "IDLE",
          text: "Limite de R$ 5.000,00 definido para o ciclo com fechamento em 05/12/2026.",
          data: {},
        }),
      );
      create();
      typeAndSend("definir limite do cartão 5000");

      buttonWithText("Confirmar")!.click();
      fixture.detectChanges();

      expect(text()).toContain("Limite de R$ 5.000,00 definido");
      expect(text()).toContain("Lançado");
      expect(buttonWithText("Confirmar")).toBeUndefined();
      expect(card().querySelector(".assistant-draft")).toBeNull();
    });

    it("DONE de reserva com envelopeId mostra sucesso sem saldo inventado", () => {
      conversation.sendMessage.and.returnValue(of(reserveConfirm()));
      conversation.confirmDraft.and.returnValue(
        of<ConversationReply>({
          kind: "DONE",
          state: "IDLE",
          text: "Reserva criada: gasolina, R$ 400,00 por mês.",
          data: { envelopeId: "env-9" },
        }),
      );
      create();
      typeAndSend("criar reserva 400 gasolina");

      buttonWithText("Confirmar")!.click();
      fixture.detectChanges();

      expect(text()).toContain("Reserva criada: gasolina, R$ 400,00 por mês.");
      expect(text()).toContain("Lançado");
      expect(card().textContent).not.toContain("saldo");
      expect(buttonWithText("Confirmar")).toBeUndefined();
    });

    it("commit desconhecido (ERROR com IDLE e sem draft) remove a confirmação anterior e não oferece nova tentativa", () => {
      conversation.sendMessage.and.returnValue(of(reserveConfirm()));
      conversation.confirmDraft.and.returnValue(
        of<ConversationReply>({
          kind: "ERROR",
          state: "IDLE",
          text: "Não foi possível confirmar o resultado. Confira a tela de Finanças antes de enviar o pedido novamente.",
        }),
      );
      create();
      typeAndSend("criar reserva 400 gasolina");

      buttonWithText("Confirmar")!.click();
      fixture.detectChanges();

      expect(text()).toContain("Não foi possível confirmar o resultado");
      expect(text()).toContain("Erro");
      expect(card().querySelector(".assistant-draft")).toBeNull();
      expect(buttonWithText("Confirmar")).toBeUndefined();
      expect(buttonWithText("Cancelar")).toBeUndefined();
      expect(buttonWithText("Tentar de novo")).toBeUndefined();
      expect(conversation.confirmDraft).toHaveBeenCalledTimes(1);
    });

    it("falha de transporte na confirmação mantém a nova tentativa com o mesmo id e versão", () => {
      conversation.sendMessage.and.returnValue(of(reserveConfirm()));
      conversation.confirmDraft.and.returnValues(
        throwError(() => ({ status: 0 })),
        of<ConversationReply>({ kind: "DONE", state: "IDLE", text: "Reserva criada.", data: { envelopeId: "env-9" } }),
      );
      create();
      typeAndSend("criar reserva 400 gasolina");

      buttonWithText("Confirmar")!.click();
      fixture.detectChanges();
      expect(buttonWithText("Tentar de novo")).toBeDefined();

      buttonWithText("Tentar de novo")!.click();
      fixture.detectChanges();

      expect(conversation.confirmDraft.calls.argsFor(1)).toEqual(["draft-1", 1]);
      expect(text()).toContain("Reserva criada.");
    });

    it("resposta antiga de DONE sem data continua mostrando o texto da resposta", () => {
      conversation.sendMessage.and.returnValue(
        of({ kind: "DONE", state: "IDLE", text: "Registrado: gasto de R$ 50,00 (mercado)." }),
      );
      create();

      typeAndSend("50 mercado");

      expect(text()).toContain("Registrado: gasto de R$ 50,00");
    });
  });
});
