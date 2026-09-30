import { CommonModule } from '@angular/common';
import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { PublicPlan } from '../../../core/models/domain.models';
import { BillingService } from '../../../core/services/billing.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ThemeToggleComponent } from '../../../shared/theme-toggle/theme-toggle.component';

const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

@Component({
    selector: 'app-landing-page',
    imports: [CommonModule, RouterLink, ThemeToggleComponent],
    templateUrl: './landing-page.component.html',
    styleUrls: ['./landing-page.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingPageComponent implements AfterViewInit {
  private readonly theme = inject(ThemeService);
  protected readonly billing = inject(BillingService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly logoSrc = computed(() =>
    this.theme.theme() === 'dark' ? 'assets/logo/lumen-mark-inverse.svg' : 'assets/logo/lumen-mark.svg',
  );

  protected readonly mobileMenuOpen = signal(false);

  /** Catálogo público de planos (GET /billing/plans, @Public no backend) — carregado uma vez ao abrir a landing. */
  protected readonly plans = signal<PublicPlan[]>([]);

  // Só o plano Individual é vendido na landing; SHARED tem sellable: false no catálogo.
  protected readonly individualPlan = computed(() =>
    this.plans().find((plan) => plan.id === 'INDIVIDUAL' && plan.sellable) ?? null,
  );

  protected readonly individualMonthlyLabel = computed(() => {
    const plan = this.individualPlan();
    return plan?.prices ? currencyFormatter.format(plan.prices.MONTHLY) : '';
  });

  protected readonly individualYearlyLabel = computed(() => {
    const plan = this.individualPlan();
    return plan?.prices ? currencyFormatter.format(plan.prices.YEARLY) : '';
  });

  @ViewChild('bgVideo') private readonly bgVideoRef?: ElementRef<HTMLVideoElement>;

  constructor() {
    this.billing
      .loadPlans()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((response) => this.plans.set(response.plans));
  }

  ngAfterViewInit() {
    const video = this.bgVideoRef?.nativeElement;
    if (!video) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      video.pause();
      return;
    }

    // Reforça o autoplay via JS — o atributo sozinho pode não disparar em
    // alguns navegadores/ambientes mesmo com muted+playsinline presentes.
    video.muted = true;
    video.play().catch(() => {
      // Autoplay bloqueado pelo navegador; sem controles visíveis não há
      // ação manual possível, mas o resto da página continua funcional.
    });
  }

  // Scroll manual em vez de depender do href="#id" nativo: dentro do SPA o
  // Router não tem anchorScrolling habilitado, então o navegador nem sempre
  // rola pra âncora de forma confiável.
  protected scrollToSection(event: Event, sectionId: string): void {
    event.preventDefault();
    this.mobileMenuOpen.set(false);
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected toggleMobileMenu(): void {
    this.mobileMenuOpen.update((open) => !open);
  }
}
