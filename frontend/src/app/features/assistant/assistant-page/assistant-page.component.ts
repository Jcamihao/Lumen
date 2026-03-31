import { CommonModule } from "@angular/common";
import { Component, DestroyRef, computed, inject, signal } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { AssistantReply } from "../../../core/models/domain.models";
import { AuthService } from "../../../core/services/auth.service";
import { LifeApiService } from "../../../core/services/life-api.service";
import { NativeStorageService } from "../../../core/services/native-storage.service";

type AssistantMessage = {
  id: string;
  question: string;
  reply: AssistantReply;
  createdAt: string;
};

@Component({
  selector: "app-assistant-page",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './assistant-page.component.html',
  styleUrls: ['./assistant-page.component.scss'],
  
})
export class AssistantPageComponent {
  private readonly api = inject(LifeApiService);
  protected readonly authService = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly storageService = inject(NativeStorageService);

  protected readonly history = signal<AssistantMessage[]>([]);
  protected readonly activeMessageId = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly consentDialogOpen = signal(false);
  protected readonly consentChecked = signal(false);
  protected readonly consentSaving = signal(false);
  protected readonly consentErrorMessage = signal<string | null>(null);
  protected readonly pendingQuestion = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
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
  protected readonly offlineMode = this.api.offlineMode;
  protected readonly quickPrompts = [
    "Analise meus gastos do mês",
    "Como posso acelerar minhas metas financeiras?",
    "Ajude-me a otimizar meu orçamento mensal",
    "Crie um planejamento financeiro para os próximos 3 meses",
  ];
  protected readonly form = this.fb.nonNullable.group({
    question: [
      "Como estou hoje?",
      [Validators.required, Validators.minLength(2)],
    ],
  });

  constructor() {
    this.restorePersistedHistory();
  }

  protected usePrompt(prompt: string) {
    this.form.controls.question.setValue(prompt);
  }

  protected selectMessage(messageId: string) {
    this.activeMessageId.set(messageId);
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
    return reply.source === "selah_ia" ? "Selah IA" : "Selah IA local";
  }

  protected sourceTone(reply: AssistantReply) {
    return reply.source === "selah_ia" ? "accent" : "warning";
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

    this.api
      .askAssistant(question)
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
          this.persistHistorySnapshot(nextHistory, message.id);
        },
        error: () => {
          this.loading.set(false);
          this.errorMessage.set(
            "Nao foi possivel consultar o assistente agora.",
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
}
