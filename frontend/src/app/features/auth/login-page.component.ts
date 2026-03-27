import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/services/auth.service';
import { FieldShellComponent } from '../../shared/components/field-shell.component';
import { UiButtonComponent } from '../../shared/components/ui-button.component';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, FieldShellComponent, UiButtonComponent],
  template: `
    <div class="auth-page">
      <section class="auth-story">
        <p class="section-kicker">codeStage Soluções</p>
        <span class="brand-logo-shell">
          <img class="brand-logo" src="assets/logo/logo_lumen.png" alt="LUMEN">
        </span>
        <h1>Organize sua vida com clareza.</h1>
        <p class="headline">Clareza para sua vida.</p>
        <p class="copy">
          Um workspace que conecta tarefas, dinheiro, rotina e objetivos com a
          sobriedade de um produto premium.
        </p>

        <div class="story-grid">
          <article>
            <strong>Visão diária</strong>
            <p>Dashboard da Vida com prioridades, saldo e previsão.</p>
          </article>
          <article>
            <strong>Decisão conectada</strong>
            <p>Tarefas com impacto financeiro e metas no mesmo fluxo.</p>
          </article>
        </div>
      </section>

      <form class="auth-card" [formGroup]="form" (ngSubmit)="submit()">
        <header>
          <h2>Entrar</h2>
          <p>Acompanhe seu dia, seu saldo e seus próximos movimentos.</p>
        </header>

        <app-field-shell label="Email">
          <input type="email" formControlName="email" placeholder="voce@exemplo.com">
        </app-field-shell>

        <app-field-shell label="Senha">
          <input type="password" formControlName="password" placeholder="Sua senha">
        </app-field-shell>

        <p class="error" *ngIf="errorMessage()">{{ errorMessage() }}</p>

        <app-ui-button type="submit" [disabled]="form.invalid || loading()" [fullWidth]="true" icon="login">
          {{ loading() ? 'Entrando...' : 'Entrar no LUMEN' }}
        </app-ui-button>

        <div class="demo-card">
          <strong>Ambiente demo</strong>
          <p><span>demo@lumen.local</span> <span>Demo123!</span></p>
        </div>

        <footer>
          <span>Ainda não tem conta?</span>
          <a routerLink="/auth/register">Criar agora</a>
        </footer>
      </form>
    </div>
  `,
  styles: [`
    .auth-page {
      min-height: 100vh;
      display: grid;
      gap: 1rem;
      padding: 1rem;
      align-items: stretch;
      max-width: 1720px;
      margin: 0 auto;
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
      align-content: center;
      gap: 0.9rem;
      min-height: 300px;
      background:
        radial-gradient(circle at top left, rgba(129, 140, 248, 0.3), transparent 26%),
        linear-gradient(145deg, #111111, #232637 68%, #1f2432);
      color: #ffffff;
      overflow: hidden;
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
      font-size: clamp(2.3rem, 6vw, 4rem);
      line-height: 1;
      letter-spacing: -0.06em;
    }

    .headline {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 700;
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
      align-self: center;
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

    .demo-card {
      display: grid;
      gap: 0.35rem;
      padding: 1rem;
      border-radius: var(--radius-lg);
      background: var(--card-muted);
      border: 1px solid var(--border);
    }

    .demo-card p {
      margin: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 0.85rem;
      color: var(--text-primary);
      font-weight: 600;
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
        grid-template-columns: minmax(0, 1.08fr) minmax(460px, 0.84fr);
        padding: 1.35rem;
      }

      .auth-story,
      .auth-card {
        min-height: calc(100vh - 2.7rem);
        padding: 2rem;
      }

      .story-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        margin-top: 1rem;
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

      .story-grid article {
        padding: 0.9rem;
      }
    }
  `],
})
export class LoginPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal('');

  protected readonly form = this.fb.nonNullable.group({
    email: ['demo@lumen.local', [Validators.required, Validators.email]],
    password: ['Demo123!', [Validators.required, Validators.minLength(6)]],
  });

  protected submit() {
    if (this.form.invalid) {
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');

    this.authService
      .login(this.form.getRawValue())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.router.navigate(['/dashboard']);
        },
        error: (error) => {
          this.loading.set(false);
          this.errorMessage.set(error?.error?.message ?? 'Não foi possível entrar.');
        },
      });
  }
}
