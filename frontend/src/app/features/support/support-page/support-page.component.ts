import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { Router } from "@angular/router";
import { SupportRequest } from "../../../core/models/domain.models";
import { AuthService } from "../../../core/services/auth.service";
import { LifeApiService } from "../../../core/services/life-api.service";

@Component({
  selector: "app-support-page",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: "./support-page.component.html",
  styleUrls: ["./support-page.component.scss"],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupportPageComponent {
  private readonly api = inject(LifeApiService);
  protected readonly authService = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  protected readonly submitting = signal(false);
  protected readonly feedbackMessage = signal("");
  protected readonly errorMessage = signal("");
  protected readonly submissions = signal<SupportRequest[]>([]);

  protected readonly form = this.fb.nonNullable.group({
    type: ["FEEDBACK" as SupportRequest["type"], [Validators.required]],
    subject: ["", [Validators.required, Validators.minLength(4), Validators.maxLength(120)]],
    message: ["", [Validators.required, Validators.minLength(12), Validators.maxLength(5000)]],
    severity: ["MEDIUM" as NonNullable<SupportRequest["severity"]>],
  });

  protected readonly selectedType = computed(() => this.form.controls.type.value);
  protected readonly bugMode = computed(() => this.selectedType() === "BUG_REPORT");
  protected readonly draftHint = computed(() =>
    this.bugMode()
      ? "Descreva o que aconteceu, como reproduzir, o resultado esperado e o impacto percebido."
      : "Conte o que foi útil, o que faltou ou o que deixaria sua experiência melhor.",
  );
  protected readonly metrics = computed(() => {
    const current = this.submissions();
    return {
      total: current.length,
      bugs: current.filter((entry) => entry.type === "BUG_REPORT").length,
      feedbacks: current.filter((entry) => entry.type === "FEEDBACK").length,
      open: current.filter((entry) => entry.status === "OPEN").length,
    };
  });

  constructor() {
    this.load();
  }

  protected submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.errorMessage.set("Preencha assunto e mensagem para enviar o suporte.");
      return;
    }

    this.submitting.set(true);
    this.feedbackMessage.set("");
    this.errorMessage.set("");

    const deviceInfo = this.buildDeviceInfo();
    const payload = {
      type: this.form.controls.type.value,
      subject: this.form.controls.subject.value.trim(),
      message: this.form.controls.message.value.trim(),
      severity: this.bugMode() ? this.form.controls.severity.value : undefined,
      screenPath: this.router.url,
      appVersion: "lumen-mobile",
      deviceInfo,
    };

    this.api
      .createSupportRequest(payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          const isBugReport = payload.type === "BUG_REPORT";
          const savedOffline = created.id.startsWith("offline-support-");
          const successMessage = savedOffline
            ? isBugReport
              ? "Bug report salvo offline. Vamos enviar assim que a conexão voltar."
              : "Feedback salvo offline. Vamos enviar assim que a conexão voltar."
            : isBugReport
              ? "Bug report enviado com sucesso."
              : "Feedback enviado com sucesso.";

          this.submissions.update((current) => [created, ...current].slice(0, 10));
          this.submitting.set(false);
          this.feedbackMessage.set(successMessage);
          this.form.patchValue({
            subject: "",
            message: "",
            severity: "MEDIUM",
          });
          this.form.markAsPristine();
          this.form.markAsUntouched();
        },
        error: (error) => {
          this.submitting.set(false);
          this.errorMessage.set(
            error?.error?.message ?? "Não foi possível enviar sua solicitação agora.",
          );
        },
      });
  }

  protected reload() {
    this.load();
  }

  protected selectType(type: SupportRequest["type"]) {
    this.form.patchValue({ type });
    this.feedbackMessage.set("");
    this.errorMessage.set("");
  }

  protected statusTone(status: SupportRequest["status"]) {
    if (status === "RESOLVED") {
      return "success";
    }

    if (status === "REVIEWED") {
      return "accent";
    }

    return "warning";
  }

  protected statusLabel(status: SupportRequest["status"]) {
    if (status === "RESOLVED") {
      return "Resolvido";
    }

    if (status === "REVIEWED") {
      return "Em análise";
    }

    return "Aberto";
  }

  protected typeTone(type: SupportRequest["type"]) {
    return type === "BUG_REPORT" ? "danger" : "accent";
  }

  protected typeLabel(type: SupportRequest["type"]) {
    return type === "BUG_REPORT" ? "Bug report" : "Feedback";
  }

  protected severityLabel(value: SupportRequest["severity"]) {
    if (value === "CRITICAL") {
      return "Crítica";
    }

    if (value === "HIGH") {
      return "Alta";
    }

    if (value === "MEDIUM") {
      return "Média";
    }

    if (value === "LOW") {
      return "Baixa";
    }

    return "Sem prioridade";
  }

  protected responseTimeEstimate() {
    return this.bugMode()
      ? "Bugs críticos: até 24h. Outros bugs: 2 a 3 dias úteis."
      : "Geralmente respondemos em até 48 horas úteis.";
  }

  private load() {
    this.loading.set(true);
    this.api
      .listSupportRequests()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (items) => {
          this.submissions.set(items);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.errorMessage.set("Não foi possível carregar o histórico de suporte.");
        },
      });
  }

  private buildDeviceInfo() {
    const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "unknown";
    const platform = typeof navigator !== "undefined" ? navigator.platform : "unknown";
    const viewport =
      typeof window !== "undefined"
        ? `${window.innerWidth}x${window.innerHeight}`
        : "unknown";

    return `platform=${platform}; viewport=${viewport}; userAgent=${userAgent}`;
  }
}
