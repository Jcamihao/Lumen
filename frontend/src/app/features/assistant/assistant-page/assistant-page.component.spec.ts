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

const draft = (overrides: Partial<DraftView> = {}): DraftView => ({
  draftId: "draft-1",
  draftVersion: 1,
  type: "EXPENSE",
  amount: "R$ 50,00",
  description: "mercado",
  category: "Alimentação",
  date: "2026-11-15",
  paymentMethod: null,
  pendingField: null,
  ...overrides,
});

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
});
