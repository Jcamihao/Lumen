import { CommonModule } from "@angular/common";
import { Component, DestroyRef, inject, signal } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import {
  CURRENT_AI_CONSENT_VERSION,
  CURRENT_PRIVACY_NOTICE_VERSION,
} from "../../core/constants/privacy.constants";
import { AuthService } from "../../core/services/auth.service";
import { LifeApiService } from "../../core/services/life-api.service";
import { ThemeService } from "../../core/services/theme.service";
import { FieldShellComponent } from "../../shared/components/field-shell.component";
import { PanelComponent } from "../../shared/components/panel.component";
import { UiBadgeComponent } from "../../shared/components/ui-badge.component";
import { UiButtonComponent } from "../../shared/components/ui-button.component";

@Component({
  selector: "app-settings-page",
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    PanelComponent,
    FieldShellComponent,
    UiButtonComponent,
    UiBadgeComponent,
  ],
  template: `
    <div class="page-stack settings-stack">
      <form class="settings-form" [formGroup]="form" (ngSubmit)="save()">
        <app-panel
          title="Perfil e base financeira"
          caption="Ajuste sua identidade operacional dentro do LUMEN"
        >
          <div class="form-grid">
            <app-field-shell label="Nome">
              <input
                type="text"
                formControlName="name"
                placeholder="Seu nome"
              />
            </app-field-shell>

            <div class="grid-2">
              <app-field-shell label="Renda mensal">
                <input
                  type="number"
                  formControlName="monthlyIncome"
                  placeholder="8500"
                />
              </app-field-shell>

              <app-field-shell label="Fechamento do mês">
                <input
                  type="number"
                  formControlName="monthClosingDay"
                  min="1"
                  max="31"
                  placeholder="30"
                />
              </app-field-shell>
            </div>

            <div class="grid-2">
              <app-field-shell label="Moeda">
                <input
                  type="text"
                  formControlName="preferredCurrency"
                  placeholder="BRL"
                />
              </app-field-shell>

              <app-field-shell label="Timezone">
                <input
                  type="text"
                  formControlName="timezone"
                  placeholder="America/Sao_Paulo"
                />
              </app-field-shell>
            </div>

            <div class="status-row">
              <app-ui-badge
                *ngIf="saved()"
                label="Preferências salvas"
                tone="success"
              />
            </div>

            <app-ui-button
              type="submit"
              [disabled]="form.invalid || saving()"
              [fullWidth]="true"
              icon="save"
            >
              {{ saving() ? "Salvando..." : "Salvar ajustes" }}
            </app-ui-button>
          </div>
        </app-panel>

        <app-panel
          title="Privacidade e IA"
          caption="Controle o uso do SelahIA e acompanhe o histórico de consentimento"
        >
          <div class="privacy-grid">
            <label
              class="consent-card"
              [class.invalid]="
                form.controls.privacyNoticeAccepted.invalid &&
                form.controls.privacyNoticeAccepted.touched
              "
            >
              <input type="checkbox" formControlName="privacyNoticeAccepted" />
              <div>
                <strong>Aviso de privacidade aceito</strong>
                <p>
                  Versão {{ privacyNoticeVersion }}.
                  {{ privacyAcceptedLabel() }}
                </p>
              </div>
            </label>

            <label class="consent-card accent">
              <input type="checkbox" formControlName="aiAssistantEnabled" />
              <div>
                <strong>Permitir processamento com SelahIA</strong>
                <p>
                  Versão {{ aiConsentVersion }}. O LUMEN compartilha apenas
                  contexto minimizado, sem email, com redacão de padrões como
                  email, CPF e telefone.
                </p>
              </div>
            </label>

            <div class="disclosure-card">
              <div class="disclosure-copy">
                <strong>Como o assistente trata seus dados</strong>
                <p>
                  O modo local funciona sem provedor externo. Quando o SelahIA
                  está ativado, a aplicação envia somente o necessário para
                  responder sua pergunta com mais contexto.
                </p>
              </div>

              <div class="badge-row">
                <app-ui-badge
                  [label]="
                    authService.currentUser()?.aiAssistantEnabled
                      ? 'SelahIA habilitado'
                      : 'Modo local ativo'
                  "
                  [tone]="
                    authService.currentUser()?.aiAssistantEnabled
                      ? 'accent'
                      : 'neutral'
                  "
                />
                <app-ui-badge
                  [label]="
                    authService.currentUser()?.aiAssistantConsentAt
                      ? 'Consentimento registrado'
                      : 'Sem consentimento externo'
                  "
                  [tone]="
                    authService.currentUser()?.aiAssistantConsentAt
                      ? 'success'
                      : 'warning'
                  "
                  [showDot]="false"
                />
              </div>
            </div>
          </div>
        </app-panel>
      </form>

      <div class="settings-grid">
        <app-panel
          title="Tema"
          caption="Troque o clima visual do seu workspace"
        >
          <div class="theme-card">
            <div>
              <strong>{{
                themeService.mode() === "light"
                  ? "Modo claro ativo"
                  : "Modo escuro ativo"
              }}</strong>
              <p>
                O contraste foi calibrado para manter leitura e sofisticação.
              </p>
            </div>
            <app-ui-button
              variant="secondary"
              icon="contrast"
              (click)="themeService.toggle()"
            >
              Alternar tema
            </app-ui-button>
          </div>
        </app-panel>

        <app-panel title="Conta" caption="Base atual do seu workspace">
          <div class="account-card">
            <strong>{{ authService.currentUser()?.email }}</strong>
            <p>
              Configuração principal para autenticação e sincronização do LUMEN.
            </p>
          </div>
        </app-panel>
      </div>

      <app-panel
        title="Direitos do titular"
        caption="Exporte seus dados pessoais ou exclua sua conta de forma facilitada"
      >
        <div class="rights-grid">
          <div class="rights-card">
            <strong>Exportação de dados</strong>
            <p>
              Gera um arquivo JSON com perfil, tarefas, finanças, metas,
              lembretes, notificações e histórico de consentimento.
            </p>
            <app-ui-button
              variant="secondary"
              icon="download"
              [disabled]="exporting()"
              (click)="downloadPrivacyExport()"
            >
              {{ exporting() ? "Gerando arquivo..." : "Baixar meus dados" }}
            </app-ui-button>
          </div>

          <div class="rights-card danger">
            <strong>Excluir conta</strong>
            <p>
              Remove sua conta e os dados associados do workspace atual. Essa
              ação é irreversível.
            </p>
            <app-ui-button
              variant="secondary"
              icon="delete"
              [disabled]="deleting()"
              (click)="deleteAccount()"
            >
              {{ deleting() ? "Excluindo..." : "Excluir minha conta" }}
            </app-ui-button>
          </div>
        </div>

        <p class="feedback" *ngIf="feedbackMessage()">
          {{ feedbackMessage() }}
        </p>
        <p class="error" *ngIf="errorMessage()">{{ errorMessage() }}</p>
      </app-panel>
    </div>
  `,
  styles: [
    `
      .settings-stack,
      .settings-form,
      .form-grid,
      .settings-grid,
      .privacy-grid,
      .rights-grid {
        display: grid;
        gap: 1rem;
      }

      .grid-2 {
        display: grid;
        gap: 0.9rem;
      }

      .status-row {
        min-height: 1.9rem;
      }

      .theme-card,
      .account-card,
      .disclosure-card,
      .rights-card,
      .consent-card {
        display: grid;
        gap: 0.7rem;
        padding: 1rem;
        border-radius: var(--radius-lg);
        border: 1px solid var(--border);
        background: var(--card-muted);
      }

      .consent-card {
        grid-template-columns: auto 1fr;
        align-items: start;
        gap: 0.85rem;
      }

      .consent-card.invalid {
        border-color: color-mix(in srgb, var(--danger) 55%, var(--border));
      }

      .consent-card.accent {
        background: color-mix(in srgb, var(--accent) 5%, var(--card));
      }

      .consent-card input {
        margin-top: 0.2rem;
        inline-size: 1rem;
        block-size: 1rem;
        accent-color: var(--accent);
      }

      .theme-card p,
      .account-card p,
      .disclosure-card p,
      .rights-card p,
      .consent-card p,
      .feedback,
      .error {
        margin: 0;
        color: var(--text-medium);
      }

      .badge-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.65rem;
      }

      .rights-card {
        align-content: start;
      }

      .rights-card.danger {
        background: color-mix(in srgb, var(--danger) 4%, var(--card));
      }

      .feedback {
        color: var(--success);
        font-size: 0.92rem;
      }

      .error {
        color: var(--danger);
        font-size: 0.92rem;
      }

      @media (min-width: 860px) {
        .grid-2,
        .settings-grid,
        .rights-grid {
          grid-template-columns: 1fr 1fr;
        }
      }

      @media (max-width: 520px) {
        .theme-card app-ui-button,
        .rights-card app-ui-button {
          width: 100%;
        }
      }
    `,
  ],
})
export class SettingsPageComponent {
  protected readonly themeService = inject(ThemeService);
  protected readonly authService = inject(AuthService);
  private readonly api = inject(LifeApiService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly saved = signal(false);
  protected readonly saving = signal(false);
  protected readonly exporting = signal(false);
  protected readonly deleting = signal(false);
  protected readonly feedbackMessage = signal("");
  protected readonly errorMessage = signal("");
  protected readonly privacyNoticeVersion = CURRENT_PRIVACY_NOTICE_VERSION;
  protected readonly aiConsentVersion = CURRENT_AI_CONSENT_VERSION;

  protected readonly form = this.fb.nonNullable.group({
    name: [
      this.authService.currentUser()?.name ?? "",
      [Validators.required, Validators.minLength(2)],
    ],
    monthlyIncome: [this.authService.currentUser()?.monthlyIncome ?? 0],
    monthClosingDay: [this.authService.currentUser()?.monthClosingDay ?? 30],
    preferredCurrency: [
      this.authService.currentUser()?.preferredCurrency ?? "BRL",
    ],
    timezone: [this.authService.currentUser()?.timezone ?? "America/Sao_Paulo"],
    privacyNoticeAccepted: [
      Boolean(this.authService.currentUser()?.privacyNoticeAcceptedAt),
      [Validators.requiredTrue],
    ],
    aiAssistantEnabled: [
      Boolean(this.authService.currentUser()?.aiAssistantEnabled),
    ],
  });

  protected save() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.errorMessage.set(
        "Aceite o aviso de privacidade para salvar as preferências.",
      );
      return;
    }

    this.saving.set(true);
    this.saved.set(false);
    this.feedbackMessage.set("");
    this.errorMessage.set("");

    this.api
      .updateUser(this.form.getRawValue())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (user) => {
          this.authService.updateStoredUser(user);
          this.saving.set(false);
          this.saved.set(true);
          this.feedbackMessage.set(
            "Preferências de privacidade e perfil atualizadas.",
          );
        },
        error: (error) => {
          this.saving.set(false);
          this.errorMessage.set(
            error?.error?.message ?? "Não foi possível salvar as preferências.",
          );
        },
      });
  }

  protected downloadPrivacyExport() {
    this.exporting.set(true);
    this.feedbackMessage.set("");
    this.errorMessage.set("");

    this.api
      .exportMyData()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (payload) => {
          const blob = new Blob([JSON.stringify(payload, null, 2)], {
            type: "application/json",
          });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `lumen-privacy-export-${new Date().toISOString().slice(0, 10)}.json`;
          link.click();
          URL.revokeObjectURL(url);
          this.exporting.set(false);
          this.feedbackMessage.set("Exportação gerada com sucesso.");
        },
        error: () => {
          this.exporting.set(false);
          this.errorMessage.set("Não foi possível gerar a exportação agora.");
        },
      });
  }

  protected deleteAccount() {
    if (
      !globalThis.confirm(
        "Deseja realmente excluir sua conta e os dados associados? Essa ação não pode ser desfeita.",
      )
    ) {
      return;
    }

    this.deleting.set(true);
    this.feedbackMessage.set("");
    this.errorMessage.set("");

    this.api
      .deleteMyAccount()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.deleting.set(false);
          this.authService.logout();
        },
        error: () => {
          this.deleting.set(false);
          this.errorMessage.set("Não foi possível excluir a conta agora.");
        },
      });
  }

  protected privacyAcceptedLabel() {
    const acceptedAt = this.authService.currentUser()?.privacyNoticeAcceptedAt;

    if (!acceptedAt) {
      return "Ainda não há aceite registrado para esta conta.";
    }

    return `Aceite registrado em ${this.formatDateTime(acceptedAt)}.`;
  }

  private formatDateTime(value: string) {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  }
}
