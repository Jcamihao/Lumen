import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { AssistantAction, AssistantModule, AssistantReply } from "../../../core/models/domain.models";
import { AuthService } from "../../../core/services/auth.service";
import { LifeApiService } from "../../../core/services/life-api.service";
import { NativeStorageService } from "../../../core/services/native-storage.service";

type AssistantMessage = {
  id: string;
  question: string;
  reply: AssistantReply;
  createdAt: string;
};

type AssistantReadingTab = "summary" | "actions" | "details";

@Component({
  selector: "app-assistant-page",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './assistant-page.component.html',
  styleUrls: ['./assistant-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantPageComponent {
  private readonly api = inject(LifeApiService);
  protected readonly authService = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly storageService = inject(NativeStorageService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly history = signal<AssistantMessage[]>([]);
  protected readonly activeMessageId = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly consentDialogOpen = signal(false);
  protected readonly consentChecked = signal(false);
  protected readonly consentSaving = signal(false);
  protected readonly consentErrorMessage = signal<string | null>(null);
  protected readonly pendingQuestion = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly actionFeedback = signal<string | null>(null);
  protected readonly runningActionIds = signal<string[]>([]);
  protected readonly originModule = signal<AssistantModule | null>(null);
  protected readonly readingTab = signal<AssistantReadingTab>("summary");
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
      [Validators.required, Validators.minLength(2)],
    ],
  });

  constructor() {
    this.restorePersistedHistory();

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
    this.form.controls.question.setValue(prompt);
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
    const question = this.form.getRawValue().question.trim();

    if (!question) {
      return;
    }

    if (this.requiresFirstAiConsent()) {
      this.pendingQuestion.set(question);
      this.consentChecked.set(false);
      this.consentErrorMessage.set(null);
      this.errorMessage.set(null);
      this.consentDialogOpen.set(true);
      return;
    }

    this.submitAssistantQuestion(question);
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
          this.persistHistorySnapshot(nextHistory, message.id);
        },
        error: () => {
          this.loading.set(false);
          this.errorMessage.set(
            "Nao foi possivel consultar o Selah agora.",
          );
        },
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
