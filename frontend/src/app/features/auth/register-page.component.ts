import { CommonModule } from "@angular/common";
import { Component, DestroyRef, inject, signal } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import {
  CURRENT_AI_CONSENT_VERSION,
  CURRENT_PRIVACY_NOTICE_VERSION,
} from "../../core/constants/privacy.constants";
import { AuthService } from "../../core/services/auth.service";
import { FieldShellComponent } from "../../shared/components/field-shell.component";
import { UiButtonComponent } from "../../shared/components/ui-button.component";

@Component({
  selector: "app-register-page",
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    FieldShellComponent,
    UiButtonComponent,
  ],
  template: `
    <div class="auth-page">
      <section class="auth-story">
        <p class="section-kicker">Nova conta</p>
        <span class="brand-logo-shell">
          <img
            class="brand-logo"
            src="assets/logo/logo_lumen.png"
            alt="LUMEN"
          />
        </span>
        <h1>Monte sua base com visão integrada.</h1>
        <p class="copy">
          Em poucos minutos você conecta prioridades, rotina e visão financeira
          no mesmo painel.
        </p>

        <div class="story-grid">
          <article>
            <strong>Tasks + Finance</strong>
            <p>O LUMEN entende o impacto real de cada compromisso.</p>
          </article>
          <article>
            <strong>Metas + Assistente</strong>
            <p>
              Objetivos ficam mais tangíveis quando o sistema orienta o caminho.
            </p>
          </article>
        </div>
      </section>

      <form class="auth-card" [formGroup]="form" (ngSubmit)="submit()">
        <header>
          <h2>Criar conta</h2>
          <p>
            Comece com seus dados principais. Depois você ajusta tudo no app.
          </p>
        </header>

        <app-field-shell label="Nome">
          <input type="text" formControlName="name" placeholder="Seu nome" />
        </app-field-shell>

        <app-field-shell label="Email">
          <input
            type="email"
            formControlName="email"
            placeholder="voce@exemplo.com"
          />
        </app-field-shell>

        <app-field-shell label="Senha">
          <input
            type="password"
            formControlName="password"
            placeholder="No mínimo 6 caracteres"
          />
        </app-field-shell>

        <app-field-shell label="Renda mensal">
          <input
            type="number"
            formControlName="monthlyIncome"
            placeholder="8500"
          />
        </app-field-shell>

        <div class="grid-2">
          <app-field-shell label="Fechamento">
            <input
              type="number"
              formControlName="monthClosingDay"
              min="1"
              max="31"
            />
          </app-field-shell>

          <app-field-shell label="Moeda">
            <input type="text" formControlName="preferredCurrency" />
          </app-field-shell>
        </div>

        <div class="consent-stack">
          <label
            class="consent-card"
            [class.invalid]="
              form.controls.privacyNoticeAccepted.invalid &&
              form.controls.privacyNoticeAccepted.touched
            "
          >
            <input type="checkbox" formControlName="privacyNoticeAccepted" />
            <div>
              <strong>Aceito o aviso de privacidade</strong>
              <p>
                Versão {{ privacyNoticeVersion }}. O LUMEN usa seus dados para
                operar conta, dashboard e lembretes com transparência e
                possibilidade de exportação e exclusão.
              </p>
            </div>
          </label>

          <label class="consent-card optional">
            <input type="checkbox" formControlName="aiAssistantEnabled" />
            <div>
              <strong>Quero habilitar o SelahIA</strong>
              <p>
                Consentimento opcional para enviar contexto minimizado ao
                assistente externo. Versão {{ aiConsentVersion }}. Você pode
                desligar depois em Settings.
              </p>
            </div>
          </label>
        </div>

        <p class="error" *ngIf="errorMessage()">{{ errorMessage() }}</p>

        <app-ui-button
          type="submit"
          [disabled]="form.invalid || loading()"
          [fullWidth]="true"
          icon="person_add"
        >
          {{ loading() ? "Criando..." : "Criar conta" }}
        </app-ui-button>

        <footer>
          <span>Já tem conta?</span>
          <a routerLink="/auth/login">Entrar</a>
        </footer>
      </form>
    </div>
  `,
  styles: [
    `
      .auth-page {
        min-height: 100vh;
        display: grid;
        gap: 1rem;
        padding: 1rem;
        align-items: stretch;
      }

      .auth-story,
      .auth-card {
        border-radius: var(--radius-2xl);
        padding: 1.5rem;
        border: 1px solid var(--border);
        box-shadow: var(--shadow-card);
      }

      .auth-story {
        display: grid;
        align-content: end;
        gap: 0.9rem;
        min-height: 300px;
        background:
          radial-gradient(
            circle at top right,
            rgba(129, 140, 248, 0.26),
            transparent 26%
          ),
          linear-gradient(145deg, #171717, #282b3a 68%, #202433);
        color: #ffffff;
      }

      .auth-story .section-kicker {
        color: rgba(255, 255, 255, 0.72);
      }

      .brand-logo-shell {
        display: inline-flex;
        width: fit-content;
        padding: 0.9rem 1rem;
        border-radius: 1.45rem;
        background: rgba(255, 255, 255, 0.94);
        border: 1px solid rgba(255, 255, 255, 0.52);
        box-shadow: 0 18px 36px rgba(0, 0, 0, 0.22);
      }

      .brand-logo {
        display: block;
        width: clamp(9.75rem, 26vw, 13.5rem);
        height: auto;
      }

      h1 {
        margin: 0;
        font-size: clamp(2.15rem, 6vw, 3.8rem);
        line-height: 1;
        letter-spacing: -0.06em;
      }

      .copy {
        margin: 0;
        max-width: 32rem;
        color: rgba(255, 255, 255, 0.74);
      }

      .story-grid {
        display: grid;
        gap: 0.85rem;
        margin-top: 0.6rem;
      }

      .story-grid article {
        padding: 1rem;
        border-radius: var(--radius-lg);
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }

      .story-grid p {
        margin: 0.25rem 0 0;
        color: rgba(255, 255, 255, 0.68);
      }

      .auth-card {
        background: var(--card);
        display: grid;
        gap: 1rem;
        align-content: start;
      }

      header h2 {
        margin: 0;
        font-size: 1.7rem;
        color: var(--text-primary);
      }

      header p,
      footer span {
        margin: 0.28rem 0 0;
        color: var(--text-medium);
      }

      .grid-2,
      .consent-stack {
        display: grid;
        gap: 0.9rem;
      }

      .consent-card {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 0.85rem;
        padding: 1rem;
        border-radius: var(--radius-lg);
        border: 1px solid var(--border);
        background: var(--card-muted);
        align-items: start;
      }

      .consent-card.invalid {
        border-color: color-mix(in srgb, var(--danger) 52%, var(--border));
      }

      .consent-card input {
        margin-top: 0.2rem;
        inline-size: 1rem;
        block-size: 1rem;
        accent-color: var(--accent);
      }

      .consent-card strong {
        display: block;
        margin-bottom: 0.2rem;
        color: var(--text-primary);
      }

      .consent-card p {
        margin: 0;
        color: var(--text-medium);
        line-height: 1.55;
        font-size: 0.92rem;
      }

      .consent-card.optional {
        background: color-mix(in srgb, var(--accent) 5%, var(--card));
      }

      .error {
        margin: 0;
        color: var(--danger);
        font-size: 0.9rem;
      }

      footer {
        display: flex;
        justify-content: space-between;
        gap: 0.75rem;
        flex-wrap: wrap;
        font-size: 0.95rem;
      }

      a {
        color: var(--accent);
        font-weight: 700;
      }

      @media (min-width: 980px) {
        .auth-page {
          grid-template-columns: 1fr 1fr;
          padding: 1.35rem;
        }

        .grid-2 {
          grid-template-columns: 1fr 1fr;
        }
      }

      @media (max-width: 979px) {
        .auth-card {
          order: 1;
        }

        .auth-story {
          order: 2;
          min-height: auto;
        }
      }

      @media (max-width: 520px) {
        .auth-page {
          padding: 0.75rem;
        }

        .auth-story,
        .auth-card {
          padding: 1.15rem;
          border-radius: var(--radius-xl);
        }

        .story-grid article,
        .consent-card {
          padding: 0.9rem;
        }
      }
    `,
  ],
})
export class RegisterPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal("");
  protected readonly privacyNoticeVersion = CURRENT_PRIVACY_NOTICE_VERSION;
  protected readonly aiConsentVersion = CURRENT_AI_CONSENT_VERSION;

  protected readonly form = this.fb.nonNullable.group({
    name: ["Marina Costa", [Validators.required, Validators.minLength(2)]],
    email: ["marina@exemplo.com", [Validators.required, Validators.email]],
    password: ["Demo123!", [Validators.required, Validators.minLength(6)]],
    monthlyIncome: [8500],
    monthClosingDay: [28],
    timezone: ["America/Sao_Paulo"],
    preferredCurrency: ["BRL"],
    privacyNoticeAccepted: [false, [Validators.requiredTrue]],
    aiAssistantEnabled: [false],
  });

  protected submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.errorMessage.set("Aceite o aviso de privacidade para continuar.");
      return;
    }

    this.loading.set(true);
    this.errorMessage.set("");

    this.authService
      .register(this.form.getRawValue())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.router.navigate(["/dashboard"]);
        },
        error: (error) => {
          this.loading.set(false);
          this.errorMessage.set(
            error?.error?.message ?? "Não foi possível criar a conta.",
          );
        },
      });
  }
}
