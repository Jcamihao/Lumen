import { CommonModule } from "@angular/common";
import { Component, DestroyRef, computed, inject, signal } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { AssistantReply } from "../../core/models/domain.models";
import { AuthService } from "../../core/services/auth.service";
import { LifeApiService } from "../../core/services/life-api.service";
import { EmptyStateComponent } from "../../shared/components/empty-state.component";
import { PanelComponent } from "../../shared/components/panel.component";
import { UiBadgeComponent } from "../../shared/components/ui-badge.component";
import { UiButtonComponent } from "../../shared/components/ui-button.component";

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
  template: `
    <div class="page-stack assistant-stack">
      <app-panel
        title="Converse com o LUMEN"
        caption="Peca prioridade, leitura financeira e proximos passos em linguagem clara."
      >
        <div class="prompt-list">
          <app-ui-button
            variant="ghost"
            size="sm"
            (click)="usePrompt('Como estou hoje?')"
          >
            Como estou hoje?
          </app-ui-button>
          <app-ui-button
            variant="ghost"
            size="sm"
            (click)="usePrompt('O que devo priorizar agora?')"
          >
            O que priorizar?
          </app-ui-button>
          <app-ui-button
            variant="ghost"
            size="sm"
            (click)="usePrompt('Como está minha vida financeira?')"
          >
            Como está minha vida financeira?
          </app-ui-button>
        </div>

        <div class="privacy-note" [class.accent]="assistantExternalMode()">
          <div>
            <strong>{{
              assistantExternalMode()
                ? "SelahIA autorizado"
                : "Modo local ativo"
            }}</strong>
            <p>
              {{
                assistantExternalMode()
                  ? "As perguntas usam contexto minimizado e redigem padrões como email, CPF e telefone antes do envio externo."
                  : "No primeiro uso da IA, o LUMEN vai pedir seu consentimento antes de enviar qualquer pergunta ao SelahIA."
              }}
            </p>
          </div>
          <app-ui-badge
            [label]="
              assistantExternalMode()
                ? 'IA externa com consentimento'
                : 'Consentimento pendente'
            "
            [tone]="assistantExternalMode() ? 'accent' : 'neutral'"
            [showDot]="assistantExternalMode()"
          />
        </div>

        <form class="form-grid" [formGroup]="form" (ngSubmit)="ask()">
          <textarea
            rows="5"
            formControlName="question"
            placeholder="Ex.: Como estou hoje?"
          ></textarea>
          <app-ui-button
            type="submit"
            [disabled]="form.invalid || loading()"
            [fullWidth]="true"
            icon="auto_awesome"
          >
            {{
              loading()
                ? "Consultando assistente..."
                : "Perguntar ao assistente"
            }}
          </app-ui-button>
        </form>

        <p class="error" *ngIf="errorMessage()">{{ errorMessage() }}</p>
      </app-panel>

      <div class="assistant-results">
        <app-panel
          class="active-panel"
          [title]="activeMessage()?.question || 'Resposta em destaque'"
          [caption]="
            activeMessage()
              ? 'Analise atual do assistente'
              : 'Sua proxima pergunta aparece aqui.'
          "
        >
          <ng-container *ngIf="activeMessage() as message; else noMessages">
            <div class="response-meta">
              <app-ui-badge
                [label]="sourceLabel(message.reply)"
                [tone]="sourceTone(message.reply)"
              />
              <app-ui-badge
                *ngIf="message.reply.confidence"
                [label]="confidenceLabel(message.reply)"
                [tone]="confidenceTone(message.reply)"
                [showDot]="false"
              />
              <app-ui-badge
                *ngIf="message.reply.focusArea"
                [label]="message.reply.focusArea"
                tone="neutral"
                [showDot]="false"
              />
              <span class="meta-date">{{
                message.createdAt | date: "dd/MM HH:mm"
              }}</span>
            </div>

            <p class="answer">{{ message.reply.answer }}</p>
            <p class="disclaimer" *ngIf="message.reply.disclaimer">
              {{ message.reply.disclaimer }}
            </p>

            <div class="block" *ngIf="message.reply.highlights.length">
              <div class="block-head">
                <strong>Destaques</strong>
                <app-ui-badge
                  [label]="message.reply.highlights.length + ' pontos'"
                  tone="accent"
                />
              </div>
              <ul>
                <li *ngFor="let item of message.reply.highlights">
                  {{ item }}
                </li>
              </ul>
            </div>

            <div class="block" *ngIf="message.reply.suggestedActions.length">
              <div class="block-head">
                <strong>Próximas ações</strong>
                <app-ui-badge
                  [label]="message.reply.suggestedActions.length + ' sugestões'"
                  tone="success"
                />
              </div>
              <ul>
                <li *ngFor="let item of message.reply.suggestedActions">
                  {{ item }}
                </li>
              </ul>
            </div>
          </ng-container>

          <ng-template #noMessages>
            <app-empty-state
              icon="forum"
              title="Nenhuma resposta ainda"
              description="Pergunte ao assistente sobre seu dia, finanças ou prioridades para abrir a primeira conversa."
            />
          </ng-template>
        </app-panel>

        <app-panel
          class="recent-panel"
          title="Mensagens recentes"
          caption="Cada nova pergunta entra aqui sem empilhar a tela."
          maxHeight="483.28px"
        >
          <ng-container *ngIf="recentMessages().length; else noRecentMessages">
            <div class="recent-list">
              <button
                *ngFor="let message of recentMessages(); trackBy: trackMessage"
                type="button"
                class="recent-item"
                [class.active]="message.id === activeMessageId()"
                (click)="selectMessage(message.id)"
              >
                <div class="recent-head">
                  <strong>{{ message.question }}</strong>
                  <span>{{ message.createdAt | date: "HH:mm" }}</span>
                </div>

                <p>{{ summarize(message.reply.answer) }}</p>

                <div class="recent-meta">
                  <app-ui-badge
                    [label]="sourceLabel(message.reply)"
                    [tone]="sourceTone(message.reply)"
                  />
                  <app-ui-badge
                    *ngIf="message.reply.focusArea"
                    [label]="message.reply.focusArea"
                    tone="neutral"
                    [showDot]="false"
                  />
                </div>
              </button>
            </div>
          </ng-container>

          <ng-template #noRecentMessages>
            <app-empty-state
              icon="history"
              title="Sem histórico recente"
              description="As respostas do assistente passam a aparecer aqui conforme você conversa com o LUMEN."
            />
          </ng-template>
        </app-panel>
      </div>

      <div
        class="consent-overlay"
        *ngIf="consentDialogOpen()"
        (click)="closeConsentDialog()"
      >
        <section
          class="consent-modal"
          (click)="$event.stopPropagation()"
          aria-labelledby="assistant-consent-title"
          aria-modal="true"
          role="dialog"
        >
          <div class="consent-header">
            <div>
              <p class="section-kicker">Primeiro uso da IA</p>
              <h3 id="assistant-consent-title">
                Autorizar o SelahIA para esta conversa
              </h3>
              <p>
                Para responder com IA externa, o LUMEN precisa do seu
                consentimento. A pergunta só será enviada depois da confirmação.
              </p>
            </div>

            <button
              type="button"
              class="consent-close"
              (click)="closeConsentDialog()"
              aria-label="Fechar aviso de consentimento"
            >
              ×
            </button>
          </div>

          <label class="consent-check">
            <input
              type="checkbox"
              [checked]="consentChecked()"
              (change)="consentChecked.set($any($event.target).checked)"
            >
            <div>
              <strong>
                Consinto com o uso do SelahIA e com o tratamento necessário para
                essa função.
              </strong>
              <p>
                O LUMEN compartilha apenas contexto minimizado, com redação de
                padrões como email, CPF e telefone. Você poderá desligar isso
                depois em Settings.
              </p>
            </div>
          </label>

          <p class="error" *ngIf="consentErrorMessage()">
            {{ consentErrorMessage() }}
          </p>

          <div class="consent-actions">
            <app-ui-button variant="ghost" (click)="closeConsentDialog()">
              Agora não
            </app-ui-button>
            <app-ui-button
              [disabled]="!consentChecked() || consentSaving()"
              icon="verified_user"
              (click)="confirmAssistantConsent()"
            >
              {{
                consentSaving()
                  ? "Salvando consentimento..."
                  : "Concordar e perguntar"
              }}
            </app-ui-button>
          </div>
        </section>
      </div>
    </div>
  `,
  styles: [
    `
      .assistant-stack,
      .form-grid {
        display: grid;
        gap: 1rem;
      }

      .assistant-results {
        display: grid;
        gap: 1rem;
      }

      .prompt-list {
        display: flex;
        flex-wrap: wrap;
        gap: 0.7rem;
        margin-bottom: 1rem;
      }

      .response-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 0.65rem;
        margin-bottom: 0.9rem;
        align-items: center;
      }

      .answer {
        margin: 0;
        color: var(--text-primary);
        font-size: 1rem;
        line-height: 1.75;
      }

      .disclaimer,
      .error {
        margin: 0.75rem 0 0;
        color: var(--text-medium);
        font-size: 0.92rem;
        line-height: 1.6;
      }

      .error {
        color: var(--danger);
      }

      .meta-date {
        margin-left: auto;
        color: var(--text-secondary);
        font-size: 0.82rem;
        font-weight: 600;
        white-space: nowrap;
      }

      .block {
        display: grid;
        gap: 0.75rem;
        margin-top: 1rem;
        padding-top: 1rem;
        border-top: 1px solid var(--border);
      }

      .block-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        flex-wrap: wrap;
      }

      ul {
        margin: 0;
        padding-left: 1rem;
        color: var(--text-medium);
        display: grid;
        gap: 0.6rem;
      }

      .recent-list {
        display: grid;
        flex: 1 1 auto;
        min-height: 0;
        gap: 0.8rem;
        overflow-y: auto;
        padding-right: 0.15rem;
      }

      .recent-item {
        display: grid;
        gap: 0.8rem;
        width: 100%;
        padding: 1rem;
        border-radius: var(--radius-md);
        border: 1px solid var(--border);
        background: var(--card-muted);
        text-align: left;
        transition:
          border-color var(--transition-fast),
          background-color var(--transition-fast),
          transform var(--transition-fast),
          box-shadow var(--transition-fast);
      }

      .recent-item:hover {
        transform: translateY(-1px);
        border-color: rgba(99, 102, 241, 0.22);
        box-shadow: var(--shadow-soft);
      }

      .recent-item.active {
        border-color: rgba(99, 102, 241, 0.35);
        background: color-mix(in srgb, var(--accent) 10%, var(--card));
        box-shadow: var(--shadow-soft);
      }

      .recent-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.8rem;
      }

      .recent-head strong {
        font-size: 0.96rem;
        line-height: 1.45;
        word-break: break-word;
      }

      .recent-head span {
        color: var(--text-secondary);
        font-size: 0.78rem;
        font-weight: 600;
        white-space: nowrap;
      }

      .recent-item p {
        margin: 0;
        color: var(--text-medium);
        font-size: 0.92rem;
        line-height: 1.55;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
      }

      .recent-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 0.55rem;
      }

      .privacy-note {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
        padding: 0.95rem 1rem;
        border-radius: var(--radius-lg);
        border: 1px solid var(--border);
        background: var(--card-muted);
        margin-bottom: 1rem;
        flex-wrap: wrap;
      }

      .privacy-note.accent {
        background: color-mix(in srgb, var(--accent) 5%, var(--card));
      }

      .privacy-note strong {
        color: var(--text-primary);
      }

      .privacy-note p {
        margin: 0.25rem 0 0;
        color: var(--text-medium);
        line-height: 1.55;
      }

      .consent-overlay {
        position: fixed;
        inset: 0;
        z-index: 60;
        display: grid;
        place-items: center;
        padding: 1.25rem;
        background: rgba(17, 17, 17, 0.46);
        backdrop-filter: blur(10px);
      }

      .consent-modal {
        width: min(100%, 36rem);
        display: grid;
        gap: 1rem;
        padding: 1.25rem;
        border-radius: var(--radius-xl);
        border: 1px solid var(--border);
        background: var(--card);
        box-shadow: var(--shadow-float);
      }

      .consent-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
      }

      .consent-header h3 {
        margin: 0.3rem 0 0;
        color: var(--text-primary);
        font-size: 1.15rem;
      }

      .consent-header p {
        margin: 0.45rem 0 0;
        color: var(--text-medium);
        line-height: 1.6;
      }

      .consent-close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: var(--card-muted);
        color: var(--text-medium);
        font-size: 1.1rem;
      }

      .consent-check {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 0.85rem;
        padding: 1rem;
        border-radius: var(--radius-lg);
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--accent) 5%, var(--card));
        align-items: start;
      }

      .consent-check input {
        width: auto;
        margin-top: 0.2rem;
        accent-color: var(--accent);
      }

      .consent-check strong {
        display: block;
        color: var(--text-primary);
        margin-bottom: 0.25rem;
      }

      .consent-check p {
        margin: 0;
        color: var(--text-medium);
        line-height: 1.55;
      }

      .consent-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.75rem;
        flex-wrap: wrap;
      }

      @media (min-width: 1080px) {
        .assistant-results {
          grid-template-columns: minmax(0, 1.45fr) minmax(20rem, 0.85fr);
          align-items: start;
        }

        .recent-panel {
          position: sticky;
          top: 1.5rem;
        }
      }

      @media (max-width: 520px) {
        .prompt-list {
          display: grid;
        }

        .prompt-list app-ui-button {
          width: 100%;
        }

        .block-head {
          display: grid;
          justify-content: stretch;
        }

        .privacy-note,
        .response-meta,
        .recent-head,
        .consent-actions {
          align-items: flex-start;
          flex-direction: column;
        }

        .meta-date {
          margin-left: 0;
        }

        .consent-modal {
          padding: 1rem;
        }
      }
    `,
  ],
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

  protected usePrompt(prompt: string) {
    this.form.controls.question.setValue(prompt);
  }

  protected selectMessage(messageId: string) {
    this.activeMessageId.set(messageId);
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

          this.loading.set(false);
          this.history.update((history) => [message, ...history]);
          this.activeMessageId.set(message.id);
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
}
