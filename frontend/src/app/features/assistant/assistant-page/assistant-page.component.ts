import { CommonModule } from "@angular/common";
import { Component, DestroyRef, computed, inject, signal } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { AssistantReply } from "../../../core/models/domain.models";
import { AuthService } from "../../../core/services/auth.service";
import { LifeApiService } from "../../../core/services/life-api.service";
import { EmptyStateComponent } from "../../../shared/components/empty-state/empty-state.component";
import { PanelComponent } from "../../../shared/components/panel/panel.component";
import { UiBadgeComponent } from "../../../shared/components/ui-badge/ui-badge.component";
import { UiButtonComponent } from "../../../shared/components/ui-button/ui-button.component";

type AssistantMessage = {
  id: string;
  question: string;
  reply: AssistantReply;
  createdAt: string;
};

@Component({
  selector: "app-assistant-page",
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    PanelComponent,
    UiButtonComponent,
    UiBadgeComponent,
    EmptyStateComponent,
  ],
  templateUrl: './assistant-page.component.html',
  styleUrls: ['./assistant-page.component.scss'],
  
})
export class AssistantPageComponent {
  private readonly api = inject(LifeApiService);
  protected readonly authService = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

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

  protected sourceLabel(reply: AssistantReply) {
    return reply.source === "selah_ia" ? "SelahIA" : "LUMEN local";
  }

  protected sourceTone(reply: AssistantReply) {
    return reply.source === "selah_ia" ? "accent" : "neutral";
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

    return "dark";
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
    return Boolean(user && !user.aiAssistantConsentAt);
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

  private persistHistorySnapshot(
    history: AssistantMessage[],
    activeMessageId: string | null,
  ) {
    const storage = this.storage();

    if (!storage) {
      return;
    }

    try {
      storage.setItem(
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
    const storage = this.storage();

    if (!storage) {
      return null;
    }

    try {
      const raw = storage.getItem(this.storageKey());

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

  private storage() {
    try {
      return typeof window !== "undefined" ? window.localStorage : null;
    } catch {
      return null;
    }
  }
}
