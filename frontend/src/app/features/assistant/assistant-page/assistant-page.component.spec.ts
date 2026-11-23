import { registerLocaleData } from "@angular/common";
import localePt from "@angular/common/locales/pt";
import { LOCALE_ID, WritableSignal, signal } from "@angular/core";
import { ComponentFixture, TestBed, fakeAsync, tick } from "@angular/core/testing";
import { Router, provideRouter } from "@angular/router";
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

  it("unrecognized na resposta não chama mais o Selah e mostra o texto de ajuda do motor", () => {
    create();

    typeAndSend("Como estou hoje?");

    expect(conversation.sendMessage).toHaveBeenCalledTimes(1);
    expect(api.askAssistant).not.toHaveBeenCalled();
    expect(text()).toContain("Assistente manual");
    expect(text()).toContain("ajuda");
  });

  it("resposta do fallback de IA (INFO com aiFallback) vira balão de texto, sem cartão", () => {
    conversation.sendMessage.and.returnValue(
      of({ kind: "INFO", state: "IDLE", text: "Seu caixa fecha no azul.", aiFallback: true }),
    );
    create();

    typeAndSend("Analise meus gastos do mês");

    expect(api.askAssistant).not.toHaveBeenCalled();
    expect(root().querySelector(".assistant-bubble")?.textContent).toContain("Seu caixa fecha no azul.");
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

  it("'importar nota' mostra o botão que abre a tela de importações", () => {
    conversation.sendMessage.and.returnValue(
      of({ kind: "HELP", state: "IDLE", text: "Para importar uma nota, abra Importações.", data: { screen: "imports" } }),
    );
    create();
    const navigate = spyOn(TestBed.inject(Router), "navigateByUrl").and.resolveTo(true);

    typeAndSend("importar nota");
    const button = buttonWithText("Abrir importações");
    expect(button).toBeDefined();
    button!.click();

    expect(navigate).toHaveBeenCalledOnceWith("/imports");
    expect(api.askAssistant).not.toHaveBeenCalled();
  });

  it("ajuda comum não mostra o botão 'Abrir importações'", () => {
    conversation.sendMessage.and.returnValue(of({ kind: "HELP", state: "IDLE", text: "Exemplos: saldo." }));
    create();

    typeAndSend("ajuda");

    expect(text()).toContain("Exemplos: saldo.");
    expect(buttonWithText("Abrir importações")).toBeUndefined();
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

  it("carregamento em estágios: 250 ms, 3 s e 5 s (com 'Pode demorar um pouco.')", fakeAsync(() => {
    const pending = new Subject<ConversationReply>();
    conversation.sendMessage.and.returnValue(pending.asObservable());
    create();

    clickCommand("50 mercado");
    tick(250);
    fixture.detectChanges();
    expect(text()).toContain("Consultando seus dados…");

    tick(2750);
    fixture.detectChanges();
    expect(text()).toContain("Organizando a resposta…");
    expect(text()).not.toContain("Pode demorar um pouco.");

    tick(2000);
    fixture.detectChanges();
    expect(text()).toContain("Pode demorar um pouco.");

    pending.next({ kind: "CANCELLED", state: "IDLE", text: "Cancelado." });
    pending.complete();
    fixture.detectChanges();
    expect(text()).not.toContain("Organizando a resposta");
  }));

  it("resposta que chega no meio da espera cancela os estágios seguintes (sem aviso preso na tela)", fakeAsync(() => {
    const pending = new Subject<ConversationReply>();
    conversation.sendMessage.and.returnValue(pending.asObservable());
    create();

    clickCommand("50 mercado");
    tick(300);
    pending.next({ kind: "CANCELLED", state: "IDLE", text: "Cancelado." });
    pending.complete();
    tick(6000);
    fixture.detectChanges();

    expect(text()).not.toContain("Consultando seus dados");
    expect(text()).not.toContain("Organizando a resposta");
    expect(text()).not.toContain("Pode demorar um pouco.");
  }));

  it("não oferece nova tentativa enquanto a requisição está em voo (sem retry no carregamento)", fakeAsync(() => {
    const pending = new Subject<ConversationReply>();
    conversation.sendMessage.and.returnValue(pending.asObservable());
    create();

    clickCommand("50 mercado");
    tick(5000);
    fixture.detectChanges();

    expect(buttonWithText("Tentar de novo")).toBeUndefined();
    expect(conversation.sendMessage).toHaveBeenCalledTimes(1);

    pending.next({ kind: "CANCELLED", state: "IDLE", text: "Cancelado." });
    pending.complete();
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

  it("limpa o campo após resposta do manual, inclusive a que veio com unrecognized", () => {
    conversation.sendMessage.and.returnValue(of({ kind: "ASK_FIELD", state: "COLLECTING_FIELDS", text: "Qual a descrição?" }));
    create();
    typeAndSend("50");
    expect(root().querySelector<HTMLTextAreaElement>("#assistant-question")!.value).toBe("");

    conversation.sendMessage.and.returnValue(of({ kind: "HELP", state: "IDLE", text: "x", unrecognized: true }));
    typeAndSend("Analise meus gastos do mês");
    expect(root().querySelector<HTMLTextAreaElement>("#assistant-question")!.value).toBe("");
  });

  it("limpa o campo após resposta do fallback de IA", () => {
    conversation.sendMessage.and.returnValue(
      of({ kind: "INFO", state: "IDLE", text: "Seu caixa fecha no azul.", aiFallback: true }),
    );
    create();

    typeAndSend("Analise meus gastos do mês");

    expect(root().querySelector<HTMLTextAreaElement>("#assistant-question")!.value).toBe("");
  });

  it("mantém o texto no campo quando a mensagem segue ao Selah (offline)", () => {
    api.offlineMode.set(true);
    create();

    typeAndSend("Analise meus gastos do mês");

    expect(api.askAssistant).toHaveBeenCalledTimes(1);
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

  describe("conta fixa e compra parcelada (item 3b2b)", () => {
    const AVISO_MATERIALIZACAO =
      "Cadastro salvo. A atualização dos lançamentos está pendente; confira a tela de Finanças.";
    const AVISO_VENCIMENTO = "Os lançamentos serão gerados nos vencimentos.";
    const AVISO_ATUALIZACAO = "Outros cadastros já vencidos também podem ser atualizados junto, como na tela.";
    const CONTA_CRIADA = "Conta fixa criada: internet, R$ 120,00, mensal, primeiro vencimento em 20/11/2026.";
    const PARCELADO_CRIADO = "Compra parcelada criada: geladeira, total R$ 1.200,00 em 12 parcelas, primeira em 20/11/2026.";

    const recurringRows = (): Array<{ label: string; value: string }> => [
      { label: "Descrição", value: "internet" },
      { label: "Valor por vencimento", value: "R$ 120,00" },
      { label: "Frequência", value: "Mensal" },
      { label: "Primeiro vencimento", value: "20/11/2026" },
      { label: "Categoria", value: "não informada" },
      { label: "Forma de pagamento", value: "não informada" },
      { label: "Aviso", value: AVISO_VENCIMENTO },
      { label: "Aviso", value: AVISO_ATUALIZACAO },
    ];

    const installmentRows = (): Array<{ label: string; value: string }> => [
      { label: "Descrição", value: "geladeira" },
      { label: "Total da compra", value: "R$ 1.200,00" },
      { label: "Quantidade", value: "12" },
      { label: "Valor por parcela", value: "R$ 100,00" },
      { label: "Última parcela", value: "R$ 100,00" },
      { label: "Primeiro vencimento", value: "20/11/2026" },
      { label: "Categoria", value: "não informada" },
      { label: "Forma de pagamento", value: "não informada" },
      { label: "Aviso", value: AVISO_VENCIMENTO },
      { label: "Aviso", value: AVISO_ATUALIZACAO },
    ];

    const recurringDraft = (overrides: Partial<DraftView> = {}) =>
      draft({
        kind: "RECURRING",
        title: "Conta fixa",
        amount: null,
        description: null,
        category: null,
        date: null,
        rows: recurringRows(),
        ...overrides,
      });

    const installmentDraft = (overrides: Partial<DraftView> = {}) =>
      draft({
        kind: "INSTALLMENT",
        title: "Compra parcelada",
        amount: null,
        description: null,
        category: null,
        date: null,
        rows: installmentRows(),
        ...overrides,
      });

    const recurringConfirm = (): ConversationReply => ({
      kind: "CONFIRM_DRAFT",
      state: "AWAITING_CONFIRMATION",
      text: "Conta fixa internet: R$ 120,00 por vencimento, mensal, primeiro vencimento em 20/11/2026.",
      draft: recurringDraft(),
      quickReplies: ["confirmar", "cancelar"],
    });

    const installmentConfirm = (): ConversationReply => ({
      kind: "CONFIRM_DRAFT",
      state: "AWAITING_CONFIRMATION",
      text: "Compra parcelada geladeira: total R$ 1.200,00 em 12 parcelas, primeira em 20/11/2026.",
      draft: installmentDraft(),
      quickReplies: ["confirmar", "cancelar"],
    });

    const card = () => root().querySelector<HTMLElement>(".assistant-manual")!;
    const rowLabels = () =>
      Array.from(card().querySelectorAll(".assistant-draft__row dt")).map((dt) => dt.textContent?.trim());
    const rowValues = () =>
      Array.from(card().querySelectorAll(".assistant-draft__row dd")).map((dd) => dd.textContent?.trim());

    it("conta fixa completa mostra título, linhas, dois avisos e botões, sem null nem campos de lançamento", () => {
      conversation.sendMessage.and.returnValue(of(recurringConfirm()));
      create();

      typeAndSend("criar conta fixa 120 internet mensal primeiro 20/11/2026");

      expect(card().querySelector(".assistant-draft__title")?.textContent?.trim()).toBe("Conta fixa");
      expect(rowLabels()).toEqual([
        "Descrição",
        "Valor por vencimento",
        "Frequência",
        "Primeiro vencimento",
        "Categoria",
        "Forma de pagamento",
        "Aviso",
        "Aviso",
      ]);
      expect(rowValues()).toContain("não informada");
      expect(rowValues()).toContain(AVISO_VENCIMENTO);
      expect(rowValues()).toContain(AVISO_ATUALIZACAO);
      expect(card().textContent).not.toContain("null");
      expect(rowLabels()).not.toContain("Valor");
      expect(rowLabels()).not.toContain("Data");
      expect(buttonWithText("Confirmar")).toBeDefined();
      expect(buttonWithText("Cancelar")).toBeDefined();
    });

    it("compra parcelada completa mostra título, linhas e os dois avisos com o mesmo rótulo", () => {
      conversation.sendMessage.and.returnValue(of(installmentConfirm()));
      create();

      typeAndSend("criar parcelado 1200 geladeira em 12x primeiro 20/11/2026");

      expect(card().querySelector(".assistant-draft__title")?.textContent?.trim()).toBe("Compra parcelada");
      expect(rowLabels()).toEqual([
        "Descrição",
        "Total da compra",
        "Quantidade",
        "Valor por parcela",
        "Última parcela",
        "Primeiro vencimento",
        "Categoria",
        "Forma de pagamento",
        "Aviso",
        "Aviso",
      ]);
      expect(rowValues()).toContain("R$ 1.200,00");
      expect(rowValues()).toContain(AVISO_VENCIMENTO);
      expect(rowValues()).toContain(AVISO_ATUALIZACAO);
      expect(card().textContent).not.toContain("null");
      expect(buttonWithText("Confirmar")).toBeDefined();
    });

    it("conta fixa restaurada sem vencimento mostra 'Falta informar: primeiro vencimento.' e nenhum Confirmar", () => {
      conversation.getSession.and.returnValue(
        of<ConversationSessionView>({
          state: "COLLECTING_FIELDS",
          draft: recurringDraft({
            pendingField: "firstDueDate",
            rows: recurringRows().map((row) =>
              row.label === "Primeiro vencimento" ? { ...row, value: "a informar" } : row,
            ),
          }),
        }),
      );
      create();

      expect(text()).toContain("Falta informar: primeiro vencimento.");
      expect(rowValues()).toContain("a informar");
      expect(buttonWithText("Confirmar")).toBeUndefined();
    });

    it("compra parcelada restaurada sem quantidade mostra 'Falta informar: quantidade de parcelas.' e valores 'a informar'", () => {
      conversation.getSession.and.returnValue(
        of<ConversationSessionView>({
          state: "COLLECTING_FIELDS",
          draft: installmentDraft({
            pendingField: "installmentsTotal",
            rows: [
              { label: "Descrição", value: "geladeira" },
              { label: "Total da compra", value: "R$ 1.200,00" },
              { label: "Quantidade", value: "a informar" },
              { label: "Valor por parcela", value: "a informar" },
              { label: "Última parcela", value: "a informar" },
              { label: "Primeiro vencimento", value: "a informar" },
              { label: "Categoria", value: "não informada" },
              { label: "Forma de pagamento", value: "não informada" },
            ],
          }),
        }),
      );
      create();

      expect(text()).toContain("Falta informar: quantidade de parcelas.");
      expect(rowValues().filter((value) => value === "a informar").length).toBe(4);
      expect(card().textContent).not.toContain("null");
      expect(buttonWithText("Confirmar")).toBeUndefined();
    });

    it("com campo pendente, a resposta de um caractere ('3' parcelas) é enviada; sem rascunho, um caractere continua bloqueado", () => {
      conversation.getSession.and.returnValue(
        of<ConversationSessionView>({
          state: "COLLECTING_FIELDS",
          draft: installmentDraft({ pendingField: "installmentsTotal" }),
        }),
      );
      conversation.sendMessage.and.returnValue(
        of<ConversationReply>({
          kind: "ASK_FIELD",
          state: "COLLECTING_FIELDS",
          text: "Qual o primeiro vencimento? Responda hoje ou uma data, como 20/11/2026.",
          draft: installmentDraft({ pendingField: "firstDueDate" }),
        }),
      );
      create();

      typeAndSend("3");

      expect(conversation.sendMessage).toHaveBeenCalledTimes(1);
      expect(conversation.sendMessage.calls.argsFor(0)[1]).toBe("3");
    });

    it("sem rascunho com campo pendente, uma pergunta de um caractere não é enviada ao assistente nem ao Selah", () => {
      conversation.getSession.and.returnValue(of<ConversationSessionView>({ state: "IDLE" }));
      create();

      typeAndSend("3");

      expect(root().querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBeTrue();
      expect(conversation.sendMessage).not.toHaveBeenCalled();
      expect(api.askAssistant).not.toHaveBeenCalled();
    });

    it("revisão por data passada: ASK_FIELD com versão maior mostra Atenção sem Confirmar; a confirmação seguinte envia a versão nova", () => {
      conversation.sendMessage.and.returnValues(
        of(recurringConfirm()),
        of<ConversationReply>({
          kind: "CONFIRM_DRAFT",
          state: "AWAITING_CONFIRMATION",
          text: "Conta fixa internet: R$ 120,00 por vencimento, mensal, primeiro vencimento em 20/11/2026.",
          draft: recurringDraft({ draftVersion: 3 }),
          quickReplies: ["confirmar", "cancelar"],
        }),
      );
      conversation.confirmDraft.and.returnValues(
        of<ConversationReply>({
          kind: "ASK_FIELD",
          state: "COLLECTING_FIELDS",
          text: "O primeiro vencimento ficou no passado. Informe uma nova data.\nQual o primeiro vencimento? Responda hoje ou uma data, como 20/11/2026.",
          draft: recurringDraft({
            draftVersion: 2,
            pendingField: "firstDueDate",
            rows: [
              { label: "Descrição", value: "internet" },
              { label: "Valor por vencimento", value: "R$ 120,00" },
              { label: "Frequência", value: "Mensal" },
              { label: "Primeiro vencimento", value: "a informar" },
              { label: "Categoria", value: "não informada" },
              { label: "Forma de pagamento", value: "não informada" },
              { label: "Atenção", value: "O primeiro vencimento ficou no passado. Informe uma nova data." },
            ],
          }),
        }),
        of<ConversationReply>({
          kind: "DONE",
          state: "IDLE",
          text: CONTA_CRIADA,
          data: { recurringTransactionId: "rec-9" },
        }),
      );
      create();
      typeAndSend("criar conta fixa 120 internet mensal primeiro 20/11/2026");

      buttonWithText("Confirmar")!.click();
      fixture.detectChanges();

      expect(rowLabels()).toContain("Atenção");
      expect(rowValues()).toContain("O primeiro vencimento ficou no passado. Informe uma nova data.");
      expect(buttonWithText("Confirmar")).toBeUndefined();
      expect(buttonWithText("Cancelar")).toBeUndefined();

      typeAndSend("20/11/2026");

      expect(rowLabels()).not.toContain("Atenção");
      buttonWithText("Confirmar")!.click();
      fixture.detectChanges();

      expect(conversation.confirmDraft.calls.argsFor(0)).toEqual(["draft-1", 1]);
      expect(conversation.confirmDraft.calls.argsFor(1)).toEqual(["draft-1", 3]);
    });

    const doneCases: Array<{
      name: string;
      kind: "recurring" | "installment";
      data: NonNullable<ConversationReply["data"]>;
      text: string;
      withWarning: boolean;
    }> = [
      { name: "conta fixa", kind: "recurring", data: { recurringTransactionId: "rec-9" }, text: CONTA_CRIADA, withWarning: false },
      { name: "conta fixa", kind: "recurring", data: { recurringTransactionId: "rec-9" }, text: CONTA_CRIADA, withWarning: true },
      { name: "compra parcelada", kind: "installment", data: { installmentPurchaseId: "inst-9" }, text: PARCELADO_CRIADO, withWarning: false },
      { name: "compra parcelada", kind: "installment", data: { installmentPurchaseId: "inst-9" }, text: PARCELADO_CRIADO, withWarning: true },
    ];

    doneCases.forEach(({ name, kind, data, text: textoCriado, withWarning }) => {
      const warningSuffix = withWarning ? " com aviso de materialização pendente" : "";

      it(`DONE de ${name} mostra sucesso, rótulo Criado e sem depender de data.card${warningSuffix}`, () => {
        conversation.sendMessage.and.returnValue(of(kind === "recurring" ? recurringConfirm() : installmentConfirm()));
        conversation.confirmDraft.and.returnValue(
          of<ConversationReply>({
            kind: "DONE",
            state: "IDLE",
            text: withWarning ? `${textoCriado}\n${AVISO_MATERIALIZACAO}` : textoCriado,
            data,
          }),
        );
        create();
        typeAndSend(kind === "recurring" ? "criar conta fixa 120 internet mensal primeiro 20/11/2026" : "criar parcelado 1200 geladeira em 12x primeiro 20/11/2026");

        buttonWithText("Confirmar")!.click();
        fixture.detectChanges();

        expect(text()).toContain(textoCriado);
        expect(card().querySelector(".proto-tag")?.textContent?.trim()).toBe("Criado");
        expect(text()).not.toContain("Lançado");
        expect(card().querySelector(".assistant-draft")).toBeNull();
        expect(card().textContent).not.toContain("null");
        expect(buttonWithText("Confirmar")).toBeUndefined();
        expect(buttonWithText("Tentar de novo")).toBeUndefined();
        expect(text().includes(AVISO_MATERIALIZACAO)).toBe(withWarning);
      });
    });

    it("commit desconhecido de conta fixa (ERROR com IDLE e sem draft) remove o cartão e não oferece nova tentativa", () => {
      conversation.sendMessage.and.returnValue(of(recurringConfirm()));
      conversation.confirmDraft.and.returnValue(
        of<ConversationReply>({
          kind: "ERROR",
          state: "IDLE",
          text: "Não foi possível confirmar o resultado. Confira a tela de Finanças antes de enviar o pedido novamente.",
        }),
      );
      create();
      typeAndSend("criar conta fixa 120 internet mensal primeiro 20/11/2026");

      buttonWithText("Confirmar")!.click();
      fixture.detectChanges();

      expect(text()).toContain("Não foi possível confirmar o resultado");
      expect(card().querySelector(".assistant-draft")).toBeNull();
      expect(buttonWithText("Confirmar")).toBeUndefined();
      expect(buttonWithText("Cancelar")).toBeUndefined();
      expect(buttonWithText("Tentar de novo")).toBeUndefined();
      expect(conversation.confirmDraft).toHaveBeenCalledTimes(1);
    });

    it("regressão: DONE de lançamento continua com rótulo Lançado", () => {
      conversation.sendMessage.and.returnValue(
        of<ConversationReply>({
          kind: "DONE",
          state: "IDLE",
          text: "Registrado: gasto de R$ 50,00 (mercado).",
          data: { transactionId: "t-1" },
        }),
      );
      create();

      typeAndSend("50 mercado");

      expect(card().querySelector(".proto-tag")?.textContent?.trim()).toBe("Lançado");
    });
  });

  describe("apagar lançamento pelo cartão (8a-2)", () => {
    const apagarRows = (): Array<{ label: string; value: string }> => [
      { label: "Valor", value: "R$ 120,00" },
      { label: "Descrição", value: "Mercado grande" },
      { label: "Categoria", value: "sem categoria" },
      { label: "Data", value: "12/11/2026" },
    ];

    const deleteDraft = (overrides: Partial<DraftView> = {}) =>
      draft({
        kind: "TRANSACTION_CHANGE",
        title: "Apagar lançamento",
        changeAction: "DELETE",
        amount: null,
        description: null,
        category: null,
        date: null,
        rows: apagarRows(),
        ...overrides,
      });

    const deleteConfirm = (): ConversationReply => ({
      kind: "CONFIRM_DRAFT",
      state: "AWAITING_CONFIRMATION",
      text: "Apagar: 120,00 · Mercado grande.\nIsto apaga de vez e não dá para desfazer.\nPara apagar, responda apagar.",
      draft: deleteDraft(),
      quickReplies: ["apagar", "cancelar"],
    });

    const card = () => root().querySelector<HTMLElement>(".assistant-manual")!;
    const rowValues = () =>
      Array.from(card().querySelectorAll(".assistant-draft__row dd")).map((dd) => dd.textContent?.trim());

    it("cartão de apagar mostra Apagar de vez, o aviso e Cancelar, sem Confirmar", () => {
      conversation.sendMessage.and.returnValue(of(deleteConfirm()));
      create();

      typeAndSend("apagar mercado");

      expect(buttonWithText("Apagar de vez")).toBeDefined();
      expect(buttonWithText("Confirmar")).toBeUndefined();
      expect(buttonWithText("Cancelar")).toBeDefined();
      expect(text()).toContain("Isto apaga de vez e não dá para desfazer.");
      expect(rowValues()).toEqual(["R$ 120,00", "Mercado grande", "sem categoria", "12/11/2026"]);
      expect(card().textContent).not.toContain("Confira os dados antes de confirmar.");
    });

    it("Apagar de vez chama confirm com delete: true, e nunca sem a flag", () => {
      conversation.sendMessage.and.returnValue(of(deleteConfirm()));
      conversation.confirmDraft.and.returnValue(
        of<ConversationReply>({ kind: "DONE", state: "IDLE", text: "Apaguei: 120,00 · Mercado grande.", data: { transactionId: "t2" } }),
      );
      create();
      typeAndSend("apagar mercado");

      clickCommand("Apagar de vez");

      expect(conversation.confirmDraft).toHaveBeenCalledTimes(1);
      expect(conversation.confirmDraft).toHaveBeenCalledWith("draft-1", 1, true);
      expect(text()).toContain("Apaguei: 120,00 · Mercado grande.");
    });

    it("atalho 'apagar' e 'cancelar' do texto não aparecem como botão no cartão de apagar", () => {
      conversation.sendMessage.and.returnValue(of(deleteConfirm()));
      create();

      typeAndSend("apagar mercado");

      expect(buttonWithText("apagar")).toBeUndefined();
      expect(buttonWithText("cancelar")).toBeUndefined();
    });

    it("cartão de editar segue com Confirmar normal, sem Apagar de vez, e confirm sem a flag", () => {
      conversation.sendMessage.and.returnValue(of(confirmReply()));
      conversation.confirmDraft.and.returnValue(new Subject<ConversationReply>().asObservable());
      create();
      typeAndSend("50 mercado");

      expect(buttonWithText("Apagar de vez")).toBeUndefined();
      clickCommand("Confirmar");

      expect(conversation.confirmDraft).toHaveBeenCalledWith("draft-1", 1);
    });

    it("Apagar de vez em voo fica desabilitado: duplo clique chama o servidor uma vez", () => {
      const pending = new Subject<ConversationReply>();
      conversation.sendMessage.and.returnValue(of(deleteConfirm()));
      conversation.confirmDraft.and.returnValue(pending.asObservable());
      create();
      typeAndSend("apagar mercado");

      const apagar = buttonWithText("Apagar de vez")!;
      apagar.click();
      apagar.click();
      fixture.detectChanges();

      expect(buttonWithText("Apagar de vez")!.disabled).toBe(true);
      expect(conversation.confirmDraft).toHaveBeenCalledTimes(1);
      expect(conversation.confirmDraft).toHaveBeenCalledWith("draft-1", 1, true);
    });

    it("sessão reaberta com apagar mostra Apagar de vez e manda delete: true", () => {
      conversation.getSession.and.returnValue(
        of<ConversationSessionView>({ state: "AWAITING_CONFIRMATION", draft: deleteDraft() }),
      );
      conversation.confirmDraft.and.returnValue(
        of<ConversationReply>({ kind: "DONE", state: "IDLE", text: "Apaguei.", data: { transactionId: "t2" } }),
      );
      create();

      expect(buttonWithText("Confirmar")).toBeUndefined();
      expect(rowValues()).toContain("Mercado grande");
      clickCommand("Apagar de vez");

      expect(conversation.confirmDraft).toHaveBeenCalledWith("draft-1", 1, true);
    });

    it("falha de transporte no apagar mantém Tentar de novo com delete: true", () => {
      conversation.sendMessage.and.returnValue(of(deleteConfirm()));
      conversation.confirmDraft.and.returnValues(
        throwError(() => ({ status: 0 })),
        of<ConversationReply>({ kind: "DONE", state: "IDLE", text: "Apaguei.", data: { transactionId: "t2" } }),
      );
      create();
      typeAndSend("apagar mercado");

      clickCommand("Apagar de vez");
      expect(buttonWithText("Tentar de novo")).toBeDefined();
      clickCommand("Tentar de novo");

      expect(conversation.confirmDraft.calls.argsFor(1)).toEqual(["draft-1", 1, true]);
      expect(text()).toContain("Apaguei.");
    });

    it("restaurado na escolha do lançamento: Falta informar e nenhum botão de apagar", () => {
      conversation.getSession.and.returnValue(
        of<ConversationSessionView>({
          state: "COLLECTING_FIELDS",
          draft: deleteDraft({ pendingField: "transaction", rows: [{ label: "Lançamento", value: "a escolher" }] }),
        }),
      );
      create();

      expect(text()).toContain("Falta informar: lançamento.");
      expect(buttonWithText("Apagar de vez")).toBeUndefined();
      expect(buttonWithText("Confirmar")).toBeUndefined();
    });
  });
});
