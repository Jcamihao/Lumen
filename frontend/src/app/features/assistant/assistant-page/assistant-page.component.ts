import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, inject, signal, viewChild } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { Observable } from "rxjs";
import { AssistantAction, AssistantModule, AssistantPulse, AssistantReply } from "../../../core/models/domain.models";
import {
  ConversationPaymentMethod,
  ConversationReply,
  ConversationReplyKind,
  ConversationSessionView,
  ConversationStateView,
  DraftView,
  ReplyData,
} from "../../../core/models/conversation.models";
import { AuthService } from "../../../core/services/auth.service";
import { ConversationApiService } from "../../../core/services/conversation-api.service";
import { LifeApiService } from "../../../core/services/life-api.service";
import { NativeStorageService } from "../../../core/services/native-storage.service";
import { readPlanLimitAction, readPlanLimitMessage } from "../../../core/utils/plan-limit.utils";

type AssistantMessage = {
  id: string;
  question: string;
  reply: AssistantReply;
  createdAt: string;
};

type AssistantReadingTab = "summary" | "actions" | "details";

/** Último turno do assistente manual. Só em memória: nunca vai para history, localStorage ou saveAssistantTurn. */
type ManualTurn = {
  question: string | null;
  kind: ConversationReplyKind | "RESTORED";
  state: ConversationStateView;
  text: string;
  draft: DraftView | null;
  quickReplies: string[];
  /** Dados do DONE (ids criados). Usados só para o rótulo "Criado" de conta fixa e parcelado. */
  data: ReplyData | null;
};

type ManualError = { text: string; retry: (() => void) | null };

/** Mensagem pendente de reentrega (decisão 5): reenviar o mesmo texto reusa o messageId. */
type ManualPending = { id: string; text: string };

/** Acima disso, o aviso "Consultando seus dados…" aparece (decisão 6). */
const MANUAL_SLOW_HINT_MS = 250;
/** Limite do motor (contrato, seção 4). Texto maior não é comando: vai direto ao Selah. */
const MANUAL_MAX_LENGTH = 500;

const PAYMENT_METHOD_LABELS: Record<ConversationPaymentMethod, string> = {
  PIX: "Pix",
  CREDIT: "Crédito",
  DEBIT: "Débito",
};

const PENDING_FIELD_LABELS = {
  amount: "valor",
  description: "descrição",
  category: "categoria",
  title: "nome",
  name: "nome",
  target: "valor-alvo",
  goal: "meta",
  installmentsTotal: "quantidade de parcelas",
  firstDueDate: "primeiro vencimento",
} as const;

@Component({
    selector: "app-assistant-page",
    imports: [CommonModule, ReactiveFormsModule, RouterLink],
    templateUrl: './assistant-page.component.html',
    styleUrls: ['./assistant-page.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class AssistantPageComponent {
  private readonly api = inject(LifeApiService);
  private readonly conversationApi = inject(ConversationApiService);
  protected readonly authService = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly storageService = inject(NativeStorageService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly manualRegion = viewChild<ElementRef<HTMLElement>>("manualRegion");

  protected readonly currencyCode = computed(
    () => this.authService.currentUser()?.preferredCurrency ?? 'BRL',
  );

  protected readonly history = signal<AssistantMessage[]>([]);
  protected readonly pulse = signal<AssistantPulse | null>(null);
  protected readonly activeMessageId = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly consentDialogOpen = signal(false);
  protected readonly consentChecked = signal(false);
  protected readonly consentSaving = signal(false);
  protected readonly consentErrorMessage = signal<string | null>(null);
  protected readonly pendingQuestion = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly errorAction = signal<{ label: string; route: string } | null>(null);
  protected readonly actionFeedback = signal<string | null>(null);
  protected readonly runningActionIds = signal<string[]>([]);
  protected readonly originModule = signal<AssistantModule | null>(null);
  protected readonly readingTab = signal<AssistantReadingTab>("summary");
  protected readonly manualTurn = signal<ManualTurn | null>(null);
  protected readonly manualBusy = signal(false);
  protected readonly manualSlow = signal(false);
  protected readonly manualError = signal<ManualError | null>(null);
  protected readonly manualCommands = ["saldo", "resumo", "50 mercado", "cartão", "ajuda"];
  private manualPending: ManualPending | null = null;
  /** Sobe a cada resposta aplicada. Uma leitura de sessão que começou antes dela é antiga e não pode sobrescrever o cartão. */
  private manualEpoch = 0;
  private manualSlowTimer: ReturnType<typeof setTimeout> | null = null;
  protected readonly activeMessage = computed<AssistantMessage | null>(() => {
    const messages = this.history();
    const activeId = this.activeMessageId();

    if (!messages.length) {
      return null;
    }

    return messages.find((message) => message.id === activeId) ?? messages[0];
  });
  protected readonly recentMessages = computed(() =>
    this.history().slice(0, 8),
  );
  protected readonly readingTabs = computed<AssistantReadingTab[]>(() => {
    const message = this.activeMessage();

    if (!message) {
      return [];
    }

    const tabs: AssistantReadingTab[] = ["summary"];

    if (this.hasActionContent(message.reply)) {
      tabs.push("actions");
    }

    if (this.hasDetailContent(message.reply)) {
      tabs.push("details");
    }

    return tabs;
  });
  protected readonly offlineMode = this.api.offlineMode;
  protected readonly quickPrompts = computed(() => {
    const module = this.originModule();

    if (module === "tasks") {
      return [
        "Qual tarefa eu deveria priorizar primeiro hoje?",
        "Como limpar minhas pendencias atrasadas sem travar o resto do dia?",
        "Transforme minha fila em um plano de foco de 2 blocos.",
        "Quais tarefas merecem energia agora e quais podem esperar?",
      ];
    }

    if (module === "finances") {
      return [
        "Analise meus gastos do mês",
        "O que eu preciso proteger primeiro no meu caixa?",
        "Como posso acelerar minhas metas financeiras?",
        "Monte um plano financeiro para os próximos 30 dias",
      ];
    }

    if (module === "goals") {
      return [
        "Como eu destravo minhas metas sem apertar o caixa?",
        "Qual meta merece aporte agora?",
        "Monte um plano de progresso realista para minhas metas.",
        "O que eu devo pausar e o que devo acelerar nas minhas metas?",
      ];
    }

    if (module === "imports") {
      return [
        "O que esta compra diz sobre meu padrão de gasto?",
        "Quais sinais essa nota fiscal merece atenção?",
        "Como encaixar essa compra no meu planejamento do mês?",
        "Que próximos passos eu devo tomar depois dessa importação?",
      ];
    }

    return [
      "Analise meus gastos do mês",
      "Como posso acelerar minhas metas financeiras?",
      "Ajude-me a otimizar meu orçamento mensal",
      "Crie um planejamento financeiro para os próximos 3 meses",
    ];
  });
  protected readonly form = this.fb.nonNullable.group({
    question: [
      "Como estou hoje?",
      [Validators.required],
    ],
  });

  /**
   * Pergunta nova pede 2 caracteres. Resposta a um campo pendente do assistente manual pode ter 1
   * (ex.: "3" em "Em quantas parcelas?"), por isso o mínimo não fica no validador do formulário.
   */
  protected canSubmitQuestion() {
    const length = this.form.getRawValue().question.trim().length;
    return length >= (this.manualTurn()?.draft?.pendingField ? 1 : 2);
  }

  constructor() {
    this.restorePersistedHistory();
    this.loadServerHistory();
    this.loadPulse();
    this.refreshManualSession();
    this.destroyRef.onDestroy(() => this.clearManualSlowTimer());

    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const prompt = params.get("prompt")?.trim() || "";
        const originModule = this.normalizeOriginModule(params.get("originModule"));

        this.originModule.set(originModule);

        if (prompt) {
          this.form.controls.question.setValue(prompt);
        }
      });
  }

  protected usePrompt(prompt: string) {
    if (this.loading()) {
      return;
    }

    this.form.controls.question.setValue(prompt);
    this.ask();
  }

  private loadPulse() {
    this.api
      .getAssistantPulse()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (pulse) => this.pulse.set(pulse),
        error: () => this.pulse.set(null),
      });
  }

  protected originModuleLabel() {
    return {
      dashboard: "Início",
      tasks: "Tarefas",
      finances: "Finanças",
      goals: "Metas",
      imports: "Importações",
      general: "Visão geral",
    }[this.originModule() || "general"];
  }

  protected selectMessage(messageId: string) {
    this.activeMessageId.set(messageId);
    this.readingTab.set("summary");
    this.persistHistorySnapshot(this.history(), messageId);
  }

  protected trackMessage(_index: number, message: AssistantMessage) {
    return message.id;
  }

  protected summarize(content: string) {
    const trimmed = content.trim();
    return trimmed.length > 116
      ? `${trimmed.slice(0, 113).trimEnd()}...`
      : trimmed;
  }

  protected answerParagraphs(content: string) {
    const normalized = String(content || "")
      .replace(/\r\n/g, "\n")
      .trim();

    if (!normalized) {
      return [];
    }

    return normalized
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
  }

  protected focusAreaLabel(reply: AssistantReply) {
    return reply.focusArea?.trim() || "Panorama";
  }

  protected sourceLabel(reply: AssistantReply) {
    return reply.source === "selah_ia" ? "IA externa" : "Modo local";
  }

  protected sourceTone(reply: AssistantReply) {
    return reply.source === "selah_ia" ? "accent" : "warning";
  }

  protected signalTone(signal: AssistantReply["proactiveSignals"][number]) {
    if (signal.severity === "critical") {
      return "danger";
    }

    if (signal.severity === "warning") {
      return "warning";
    }

    return "accent";
  }

  protected simulationTone(simulation: AssistantReply["simulations"][number]) {
    if (simulation.monthlyDelta > 0) {
      return "success";
    }

    if (simulation.monthlyDelta < 0) {
      return "warning";
    }

    return "accent";
  }

  protected isRunningAction(actionId: string) {
    return this.runningActionIds().includes(actionId);
  }

  protected setReadingTab(tab: AssistantReadingTab) {
    this.readingTab.set(tab);
  }

  protected readingTabLabel(tab: AssistantReadingTab) {
    return {
      summary: "Resumo",
      actions: "Ações",
      details: "Detalhes",
    }[tab];
  }

  protected hasActionContent(reply: AssistantReply) {
    return (
      reply.suggestedActions.length > 0 ||
      reply.actions.length > 0 ||
      !!reply.continuity.nextQuestion ||
      !!reply.continuity.followUpPrompt
    );
  }

  protected hasDetailContent(reply: AssistantReply) {
    return (
      reply.proactiveSignals.length > 0 ||
      reply.simulations.length > 0 ||
      reply.explainability.reasoning.length > 0 ||
      reply.explainability.evidence.length > 0 ||
      !!reply.continuity.memorySummary ||
      !!reply.continuity.followUpPrompt ||
      !!reply.continuity.nextQuestion ||
      !!reply.disclaimer
    );
  }

  protected executeAction(action: AssistantAction) {
    this.actionFeedback.set(null);

    if (action.kind === "open_module" && action.route) {
      void this.router.navigateByUrl(action.route);
      return;
    }

    this.runningActionIds.update((current) => [...current, action.id]);

    this.api
      .applyAssistantAction(action)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.runningActionIds.update((current) =>
            current.filter((id) => id !== action.id),
          );
          this.actionFeedback.set(`${action.title} foi aplicada no Lumen.`);
        },
        error: () => {
          this.runningActionIds.update((current) =>
            current.filter((id) => id !== action.id),
          );
          this.actionFeedback.set(
            "Nao foi possivel executar essa acao agora.",
          );
        },
      });
  }

  protected useFollowUpPrompt(prompt: string | null | undefined) {
    if (!prompt) {
      return;
    }

    this.form.controls.question.setValue(prompt);
  }

  protected assistantExternalMode() {
    const user = this.authService.currentUser();
    return Boolean(
      user?.privacyNoticeAcceptedAt &&
        user?.aiAssistantEnabled &&
        user?.aiAssistantConsentAt,
    );
  }

  protected confidenceLabel(reply: AssistantReply) {
    if (reply.confidence === "high") {
      return "Alta confianca";
    }

    if (reply.confidence === "low") {
      return "Baixa confianca";
    }

    return "Confianca media";
  }

  protected confidenceTone(reply: AssistantReply) {
    if (reply.confidence === "high") {
      return "success";
    }

    if (reply.confidence === "low") {
      return "warning";
    }

    return "accent";
  }

  protected confidenceValueLabel(value: "low" | "medium" | "high") {
    return this.confidenceLabel({
      answer: "",
      highlights: [],
      suggestedActions: [],
      actions: [],
      proactiveSignals: [],
      simulations: [],
      continuity: {
        historyCount: 0,
        memorySummary: null,
        nextQuestion: null,
        followUpPrompt: null,
        originModule: null,
      },
      explainability: {
        reasoning: [],
        evidence: [],
        confidenceReason: "",
      },
      confidence: value,
    });
  }

  protected ask() {
    if (!this.canSubmitQuestion()) {
      return;
    }

    this.sendQuestion(this.form.getRawValue().question.trim());
  }

  /** Decisão 1: manual primeiro (online); Selah só quando o motor não reconhece o texto. */
  protected sendQuestion(question: string) {
    if (!question || this.manualBusy()) {
      return;
    }

    if (this.offlineMode() || question.length > MANUAL_MAX_LENGTH) {
      this.askSelah(question);
      return;
    }

    this.sendManual(question);
  }

  protected sendQuickReply(reply: string) {
    this.sendQuestion(reply.trim());
  }

  private askSelah(question: string) {
    if (this.requiresFirstAiConsent()) {
      this.pendingQuestion.set(question);
      this.consentChecked.set(false);
      this.consentErrorMessage.set(null);
      this.errorMessage.set(null);
      this.errorAction.set(null);
      this.consentDialogOpen.set(true);
      return;
    }

    this.submitAssistantQuestion(question);
  }

  private sendManual(question: string) {
    const pending = this.manualPending?.text === question ? this.manualPending : null;
    const messageId = pending?.id ?? this.newMessageId();
    this.manualPending = { id: messageId, text: question };
    this.manualError.set(null);
    this.startManualBusy();

    this.conversationApi
      .sendMessage(messageId, question)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (reply) => {
          this.endManualBusy();

          if (!this.isValidReply(reply)) {
            // Não sabemos se o servidor processou: manter o messageId deixa o reenvio idempotente.
            this.failMalformed(() => this.sendManual(question));
            return;
          }

          this.manualPending = null;

          // Não reconheceu o texto livre: segue o fluxo do Selah, sem mudar nada dele.
          if (reply.unrecognized) {
            this.askSelah(question);
            return;
          }

          this.applyManualReply(question, reply);
          this.clearQuestionIfUnchanged(question);
        },
        error: (error) => {
          this.endManualBusy();
          const status = this.statusOf(error);

          // Erro do manual nunca cai no Selah. Rede, 429 ou 5xx: guarda o pendente para reenviar.
          if (this.isRetryable(status)) {
            this.manualError.set({
              text:
                status === 429
                  ? "Muitas mensagens em pouco tempo. Aguarde um instante e tente de novo."
                  : "Não foi possível enviar sua mensagem agora.",
              retry: () => this.sendManual(question),
            });
            return;
          }

          this.manualPending = null;
          this.manualError.set({
            text: "Não foi possível enviar esta mensagem.",
            retry: null,
          });
        },
      });
  }

  protected confirmDraft() {
    const draft = this.manualTurn()?.draft;

    if (!draft || this.manualBusy()) {
      return;
    }

    this.runDraftAction(
      () => this.conversationApi.confirmDraft(draft.draftId, draft.draftVersion),
      "Não foi possível confirmar agora.",
      () => this.confirmDraft(),
    );
  }

  protected cancelDraft() {
    const draft = this.manualTurn()?.draft;

    if (!draft || this.manualBusy()) {
      return;
    }

    this.runDraftAction(
      () => this.conversationApi.cancelDraft(draft.draftId),
      "Não foi possível cancelar agora.",
      () => this.cancelDraft(),
    );
  }

  protected retryManual() {
    this.manualError()?.retry?.();
  }

  protected draftPaymentLabel(method: ConversationPaymentMethod | null) {
    return method ? PAYMENT_METHOD_LABELS[method] : null;
  }

  /** "2026-11-15" vira "15/11/2026". Outro formato passa como veio. */
  protected draftDateLabel(date: string | null) {
    if (!date) {
      return null;
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : date;
  }

  protected pendingFieldLabel(field: DraftView["pendingField"]) {
    return field ? PENDING_FIELD_LABELS[field] : null;
  }

  /** Conta fixa e parcelado são cadastros: o rótulo é "Criado", não "Lançado". Os demais DONE seguem como antes. */
  protected doneTagLabel(turn: ManualTurn) {
    if (turn.kind !== "DONE") {
      return "Erro";
    }

    return turn.data?.recurringTransactionId || turn.data?.installmentPurchaseId ? "Criado" : "Lançado";
  }

  protected manualTone(turn: ManualTurn) {
    if (turn.kind === "DONE") {
      return "success";
    }

    if (turn.kind === "ERROR") {
      return "danger";
    }

    return "neutral";
  }

  private runDraftAction(
    call: () => Observable<ConversationReply>,
    failureText: string,
    retry: () => void,
  ) {
    const question = this.manualTurn()?.question ?? null;
    this.manualError.set(null);
    this.startManualBusy();

    call()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (reply) => {
          this.endManualBusy();

          if (!this.isValidReply(reply)) {
            this.failMalformed();
            return;
          }

          this.applyManualReply(question, reply);
        },
        error: (error) => {
          this.endManualBusy();
          const status = this.statusOf(error);

          if (status === 404) {
            // O rascunho não existe mais: tira o cartão com botões já e confere o que sobrou no servidor.
            this.manualTurn.set(null);
            this.manualError.set({
              text: "Rascunho não encontrado ou já usado.",
              retry: null,
            });
            this.refreshManualSession();
            return;
          }

          this.manualError.set({
            text: failureText,
            retry: this.isRetryable(status) ? retry : null,
          });
        },
      });
  }

  /** Resposta sem `kind` ou `text` (proxy, erro de versão): não vira cartão vazio. */
  private isValidReply(reply: unknown): reply is ConversationReply {
    const candidate = reply as Partial<ConversationReply> | null;
    return (
      !!candidate &&
      typeof candidate === "object" &&
      typeof candidate.kind === "string" &&
      typeof candidate.text === "string"
    );
  }

  /** Resposta ilegível: não sabemos o que o servidor fez. Avisa e relê a sessão para mostrar o estado real. */
  private failMalformed(retry: (() => void) | null = null) {
    this.manualError.set({ text: "Resposta inesperada do servidor.", retry });
    this.refreshManualSession();
  }

  /** Comando já tratado: limpa o campo para a próxima resposta (ex.: descrição pedida) não se misturar com ele. */
  private clearQuestionIfUnchanged(question: string) {
    if (this.form.controls.question.value.trim() === question) {
      this.form.controls.question.setValue("");
    }
  }

  protected showConfirmButtons(turn: ManualTurn) {
    return turn.state === "AWAITING_CONFIRMATION" && !!turn.draft;
  }

  /** Com botões na tela, "confirmar" e "cancelar" como atalho de texto só repetem os botões. */
  protected visibleQuickReplies(turn: ManualTurn) {
    if (!this.showConfirmButtons(turn)) {
      return turn.quickReplies;
    }

    return turn.quickReplies.filter(
      (reply) => !["confirmar", "cancelar"].includes(reply.trim().toLowerCase()),
    );
  }

  private applyManualReply(question: string | null, reply: ConversationReply) {
    this.manualEpoch++;
    this.manualTurn.set({
      question,
      kind: reply.kind,
      state: reply.state,
      text: reply.text,
      draft: reply.draft ?? null,
      quickReplies: reply.quickReplies ?? [],
      data: reply.data ?? null,
    });

    // Mensagem já processada: o estado real está no servidor. Atualiza o cartão com ele.
    if (reply.kind === "DUPLICATE") {
      this.refreshManualSession();
    }

    // O cartão fica acima do campo de pergunta: no celular a resposta nasceria fora da tela.
    afterNextRender(
      () => this.manualRegion()?.nativeElement.scrollIntoView?.({ block: "nearest" }),
      { injector: this.injector },
    );
  }

  private refreshManualSession() {
    if (this.offlineMode()) {
      return;
    }

    const epoch = this.manualEpoch;

    this.conversationApi
      .getSession()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (session) => {
          // Uma resposta mais nova já mexeu no cartão: esta leitura ficou velha.
          if (epoch === this.manualEpoch) {
            this.applySession(session);
          }
        },
        error: () => {
          /* silencioso: sem sessão visível, a tela segue normal */
        },
      });
  }

  private applySession(session: ConversationSessionView) {
    if (session.state === "IDLE" || !session.draft) {
      // Rascunho que sumiu no servidor não pode continuar aparecendo com botões.
      if (this.manualTurn()?.draft) {
        this.manualTurn.set(null);
      }
      return;
    }

    this.manualTurn.set({
      question: null,
      kind: "RESTORED",
      state: session.state,
      text: "Você tem um rascunho em andamento.",
      draft: session.draft,
      quickReplies: [],
      data: null,
    });
  }

  private startManualBusy() {
    this.manualBusy.set(true);
    this.manualSlow.set(false);
    this.clearManualSlowTimer();
    this.manualSlowTimer = setTimeout(() => {
      this.manualSlowTimer = null;
      this.manualSlow.set(true);
    }, MANUAL_SLOW_HINT_MS);
  }

  private endManualBusy() {
    this.manualBusy.set(false);
    this.manualSlow.set(false);
    this.clearManualSlowTimer();
  }

  private clearManualSlowTimer() {
    if (this.manualSlowTimer !== null) {
      clearTimeout(this.manualSlowTimer);
      this.manualSlowTimer = null;
    }
  }

  /** UUID v4 para o messageId. randomUUID só existe em contexto seguro (https/localhost); getRandomValues existe sempre. */
  private newMessageId() {
    const webCrypto = globalThis.crypto;

    if (typeof webCrypto.randomUUID === "function") {
      return webCrypto.randomUUID();
    }

    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  private statusOf(error: unknown) {
    return (error as { status?: number } | null)?.status ?? 0;
  }

  /** Sem rede (status 0), limite de uso (429) ou erro do servidor (5xx): vale tentar de novo. */
  private isRetryable(status: number) {
    return status === 0 || status === 429 || status >= 500;
  }

  protected closeConsentDialog() {
    this.consentDialogOpen.set(false);
    this.consentChecked.set(false);
    this.consentSaving.set(false);
    this.consentErrorMessage.set(null);
  }

  protected confirmAssistantConsent() {
    const question = this.pendingQuestion();

    if (!this.consentChecked()) {
      this.consentErrorMessage.set(
        "Marque o checkbox para liberar o primeiro uso da IA.",
      );
      return;
    }

    if (!question) {
      this.closeConsentDialog();
      return;
    }

    this.consentSaving.set(true);
    this.consentErrorMessage.set(null);

    this.api
      .updateUser({
        privacyNoticeAccepted: true,
        aiAssistantEnabled: true,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (user) => {
          this.authService.updateStoredUser(user);
          this.closeConsentDialog();
          this.pendingQuestion.set(null);
          this.submitAssistantQuestion(question);
        },
        error: (error) => {
          this.consentSaving.set(false);
          this.consentErrorMessage.set(
            error?.error?.message ??
              "Nao foi possivel registrar o consentimento agora.",
          );
        },
      });
  }

  private requiresFirstAiConsent() {
    const user = this.authService.currentUser();
    return Boolean(!this.offlineMode() && user && !user.aiAssistantConsentAt);
  }

  private submitAssistantQuestion(question: string) {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.errorAction.set(null);
    this.actionFeedback.set(null);

    this.api
      .askAssistant(question, {
        originModule: this.originModule(),
        history: this.historyForRequest(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (reply) => {
          const message: AssistantMessage = {
            id: this.createMessageId(),
            question,
            reply,
            createdAt: reply.generatedAt || new Date().toISOString(),
          };
          const nextHistory = [message, ...this.history()].slice(0, 20);

          this.loading.set(false);
          this.history.set(nextHistory);
          this.activeMessageId.set(message.id);
          this.readingTab.set("summary");
          this.manualTurn.set(null);
          this.persistHistorySnapshot(nextHistory, message.id);
          this.persistTurnToServer(question, reply);
        },
        error: (error) => {
          this.loading.set(false);
          this.errorMessage.set(
            readPlanLimitMessage(error) ?? "Nao foi possivel consultar o Selah agora.",
          );
          this.errorAction.set(readPlanLimitAction(error));
        },
      });
  }

  private persistTurnToServer(question: string, reply: AssistantReply) {
    if (this.offlineMode()) return;

    this.api
      .saveAssistantTurn({
        question,
        answer: reply.answer,
        focusArea: reply.focusArea ?? null,
        source: reply.source ?? null,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => { /* silent — local storage is primary */ } });
  }

  private loadServerHistory() {
    if (this.offlineMode()) return;

    this.api
      .listAssistantHistory(20)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (turns) => {
          if (!turns.length) return;

          const serverMessages: AssistantMessage[] = turns.map((turn) => ({
            id: `server-${turn.id}`,
            question: turn.question,
            reply: {
              answer: turn.answer,
              highlights: [],
              suggestedActions: [],
              actions: [],
              proactiveSignals: [],
              simulations: [],
              continuity: { historyCount: 0, memorySummary: null, nextQuestion: null, followUpPrompt: null, originModule: null },
              explainability: { reasoning: [], evidence: [], confidenceReason: '' },
              focusArea: turn.focusArea ?? undefined,
              source: (turn.source as AssistantReply['source']) ?? 'lumen_fallback',
              confidence: 'medium',
              disclaimer: null,
              generatedAt: turn.createdAt,
            },
            createdAt: turn.createdAt,
          }));

          // Merge server history with local — deduplicate by question+createdAt
          const existing = this.history();
          if (existing.length) return; // local already loaded, keep it

          this.history.set(serverMessages);
          this.activeMessageId.set(serverMessages[0]?.id ?? null);
          this.persistHistorySnapshot(serverMessages, serverMessages[0]?.id ?? null);
        },
        error: () => { /* silent */ },
      });
  }

  private createMessageId() {
    return `assistant-message-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
  }

  private restorePersistedHistory() {
    const snapshot = this.readPersistedSnapshot();

    if (!snapshot?.history.length) {
      return;
    }

    this.history.set(snapshot.history);
    this.activeMessageId.set(
      snapshot.activeMessageId &&
        snapshot.history.some((message) => message.id === snapshot.activeMessageId)
        ? snapshot.activeMessageId
        : snapshot.history[0]?.id ?? null,
    );
  }

  protected openConsentDialog() {
    this.pendingQuestion.set(this.form.getRawValue().question.trim() || null);
    this.consentChecked.set(false);
    this.consentErrorMessage.set(null);
    this.consentDialogOpen.set(true);
  }

  private persistHistorySnapshot(
    history: AssistantMessage[],
    activeMessageId: string | null,
  ) {
    try {
      this.storageService.setItem(
        this.storageKey(),
        JSON.stringify({
          history,
          activeMessageId,
        }),
      );
    } catch {
      // Ignore storage failures quietly.
    }
  }

  private readPersistedSnapshot():
    | { history: AssistantMessage[]; activeMessageId: string | null }
    | null {
    try {
      const raw = this.storageService.getItem(this.storageKey());

      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw) as {
        history?: AssistantMessage[];
        activeMessageId?: string | null;
      };

      const history = Array.isArray(parsed.history)
        ? parsed.history.filter(
            (message): message is AssistantMessage =>
              Boolean(
                message &&
                  typeof message.id === "string" &&
                  typeof message.question === "string" &&
                  typeof message.createdAt === "string" &&
                  message.reply &&
                  typeof message.reply.answer === "string",
              ),
          )
        : [];

      return {
        history: history.slice(0, 20),
        activeMessageId:
          typeof parsed.activeMessageId === "string"
            ? parsed.activeMessageId
            : null,
      };
    } catch {
      return null;
    }
  }

  private storageKey() {
    return `lumen:assistant-history:${this.authService.currentUser()?.id ?? "anonymous"}`;
  }

  private historyForRequest() {
    return this.history()
      .slice(0, 6)
      .map((message) => ({
        question: message.question,
        answer: message.reply.answer,
        focusArea: message.reply.focusArea || null,
        createdAt: message.createdAt,
      }));
  }

  private normalizeOriginModule(value: string | null): AssistantModule | null {
    if (
      value === "dashboard" ||
      value === "tasks" ||
      value === "finances" ||
      value === "goals" ||
      value === "imports" ||
      value === "general"
    ) {
      return value;
    }

    return null;
  }
}
