import { CommonModule } from "@angular/common";
import { Component, DestroyRef, inject, signal } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import {
  CURRENT_AI_CONSENT_VERSION,
  CURRENT_PRIVACY_NOTICE_VERSION,
} from "../../../core/constants/privacy.constants";
import { AuthService } from "../../../core/services/auth.service";
import { LifeApiService } from "../../../core/services/life-api.service";
import { ThemeService } from "../../../core/services/theme.service";
import { AvatarComponent } from "../../../shared/components/avatar/avatar.component";
import { FieldShellComponent } from "../../../shared/components/field-shell/field-shell.component";
import { PanelComponent } from "../../../shared/components/panel/panel.component";
import { UiBadgeComponent } from "../../../shared/components/ui-badge/ui-badge.component";
import { UiButtonComponent } from "../../../shared/components/ui-button/ui-button.component";

@Component({
  selector: "app-settings-page",
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    PanelComponent,
    AvatarComponent,
    FieldShellComponent,
    UiButtonComponent,
    UiBadgeComponent,
  ],
  templateUrl: './settings-page.component.html',
  styleUrls: ['./settings-page.component.scss'],
  
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
  protected readonly avatarPreview = signal<string | null>(
    this.authService.currentUser()?.avatarUrl ?? null,
  );
  protected readonly privacyNoticeVersion = CURRENT_PRIVACY_NOTICE_VERSION;
  protected readonly aiConsentVersion = CURRENT_AI_CONSENT_VERSION;

  protected readonly form = this.fb.nonNullable.group({
    name: [
      this.authService.currentUser()?.name ?? "",
      [Validators.required, Validators.minLength(2)],
    ],
    avatarUrl: [this.authService.currentUser()?.avatarUrl ?? ""],
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

  protected handleAvatarSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      this.errorMessage.set("Selecione uma imagem válida para a foto de perfil.");
      input.value = "";
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      this.errorMessage.set("A foto deve ter no máximo 2 MB.");
      input.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      this.form.patchValue({ avatarUrl: result });
      this.avatarPreview.set(result || null);
      this.errorMessage.set("");
    };
    reader.readAsDataURL(file);
  }

  protected clearAvatar(input: HTMLInputElement) {
    this.form.patchValue({ avatarUrl: "" });
    this.avatarPreview.set(null);
    input.value = "";
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
