import { CommonModule } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { Router } from "@angular/router";
import { environment } from "../../../../environments/environment";
import {
  CURRENT_AI_CONSENT_VERSION,
  CURRENT_PRIVACY_NOTICE_VERSION,
} from "../../../core/constants/privacy.constants";
import { AuthService } from "../../../core/services/auth.service";
import { LifeApiService } from "../../../core/services/life-api.service";
import { ThemeId, ThemeService } from "../../../core/services/theme.service";

@Component({
  selector: "app-settings-page",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: "./settings-page.component.html",
  styleUrls: ["./settings-page.component.scss"],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPageComponent {
  private qrCodeModulePromise: Promise<typeof import("qrcode")> | null = null;
  protected readonly mfaFeatureEnabled = environment.mfaEnabled;
  protected readonly themeService = inject(ThemeService);
  protected readonly authService = inject(AuthService);
  private readonly api = inject(LifeApiService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  protected readonly saved = signal(false);
  protected readonly saving = signal(false);
  protected readonly exporting = signal(false);
  protected readonly deleting = signal(false);
  protected readonly loggingOutAllDevices = signal(false);
  protected readonly mfaSetupLoading = signal(false);
  protected readonly mfaActionLoading = signal(false);
  protected readonly themes = this.themeService.themes;
  protected readonly feedbackMessage = signal("");
  protected readonly errorMessage = signal("");
  protected readonly mfaSetupSecret = signal<string | null>(null);
  protected readonly mfaSetupOtpAuthUrl = signal<string | null>(null);
  protected readonly mfaQrCodeDataUrl = signal<string | null>(null);
  protected readonly recoveryCodes = signal<string[]>([]);
  protected readonly avatarPreview = signal<string | null>(
    this.authService.currentUser()?.avatarUrl ?? null,
  );
  protected readonly privacyNoticeVersion = CURRENT_PRIVACY_NOTICE_VERSION;
  protected readonly aiConsentVersion = CURRENT_AI_CONSENT_VERSION;
  protected readonly activeTab = signal<
    "profile" | "finance" | "privacy" | "theme" | "account"
  >("profile");
  protected readonly settingsTabs = [
    { id: "profile" as const, label: "Perfil" },
    { id: "finance" as const, label: "Finanças" },
    { id: "privacy" as const, label: "Privacidade" },
    { id: "theme" as const, label: "Tema" },
    { id: "account" as const, label: "Conta" },
  ];

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
  protected readonly mfaSetupForm = this.fb.nonNullable.group({
    code: ["", [Validators.required, Validators.minLength(6)]],
  });
  protected readonly mfaManageForm = this.fb.nonNullable.group({
    code: ["", [Validators.required, Validators.minLength(6)]],
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

  protected logoutAllDevices() {
    if (
      !globalThis.confirm(
        "Deseja encerrar a sessão em todos os dispositivos? Você precisará entrar novamente em cada um deles.",
      )
    ) {
      return;
    }

    this.loggingOutAllDevices.set(true);
    this.feedbackMessage.set("");
    this.errorMessage.set("");
    this.authService.logoutAllDevices();
  }

  protected startMfaSetup() {
    this.mfaSetupLoading.set(true);
    this.feedbackMessage.set("");
    this.errorMessage.set("");

    this.authService
      .startMfaSetup()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: async (response) => {
          try {
            this.mfaSetupSecret.set(response.secret);
            this.mfaSetupOtpAuthUrl.set(response.otpauthUrl);
            const qrCode = await this.getQrCodeModule();
            this.mfaQrCodeDataUrl.set(
              await qrCode.toDataURL(response.otpauthUrl, {
                width: 220,
                margin: 1,
              }),
            );
            this.mfaSetupForm.reset({ code: "" });
            this.recoveryCodes.set([]);
            this.feedbackMessage.set(
              "Escaneie o QR code no seu app autenticador e confirme com o primeiro código.",
            );
          } catch {
            this.mfaSetupSecret.set(null);
            this.mfaSetupOtpAuthUrl.set(null);
            this.mfaQrCodeDataUrl.set(null);
            this.errorMessage.set(
              "Não foi possível preparar o QR code do MFA agora.",
            );
          } finally {
            this.mfaSetupLoading.set(false);
          }
        },
        error: (error) => {
          this.mfaSetupLoading.set(false);
          this.errorMessage.set(
            error?.error?.message ??
              "Não foi possível iniciar a configuração do MFA agora.",
          );
        },
      });
  }

  protected confirmMfaSetup() {
    if (this.mfaSetupForm.invalid) {
      this.mfaSetupForm.markAllAsTouched();
      return;
    }

    this.mfaActionLoading.set(true);
    this.feedbackMessage.set("");
    this.errorMessage.set("");

    this.authService
      .confirmMfaSetup(this.mfaSetupForm.getRawValue())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.mfaActionLoading.set(false);
          this.recoveryCodes.set(response.recoveryCodes);
          this.mfaSetupSecret.set(null);
          this.mfaSetupOtpAuthUrl.set(null);
          this.mfaQrCodeDataUrl.set(null);
          this.mfaSetupForm.reset({ code: "" });
          this.mfaManageForm.reset({ code: "" });
          this.feedbackMessage.set(
            "MFA ativado com sucesso. Guarde seus códigos de recuperação em um local seguro.",
          );
        },
        error: (error) => {
          this.mfaActionLoading.set(false);
          this.errorMessage.set(
            error?.error?.message ??
              "Não foi possível confirmar a ativação do MFA.",
          );
        },
      });
  }

  protected regenerateRecoveryCodes() {
    if (this.mfaManageForm.invalid) {
      this.mfaManageForm.markAllAsTouched();
      return;
    }

    this.mfaActionLoading.set(true);
    this.feedbackMessage.set("");
    this.errorMessage.set("");

    this.authService
      .regenerateMfaRecoveryCodes(this.mfaManageForm.getRawValue())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.mfaActionLoading.set(false);
          this.recoveryCodes.set(response.recoveryCodes);
          this.mfaManageForm.reset({ code: "" });
          this.feedbackMessage.set(
            "Novos códigos de recuperação gerados. Os anteriores deixaram de valer.",
          );
        },
        error: (error) => {
          this.mfaActionLoading.set(false);
          this.errorMessage.set(
            error?.error?.message ??
              "Não foi possível gerar novos códigos de recuperação.",
          );
        },
      });
  }

  protected disableMfa() {
    if (this.mfaManageForm.invalid) {
      this.mfaManageForm.markAllAsTouched();
      return;
    }

    if (
      !globalThis.confirm(
        "Deseja desativar o MFA desta conta? O login voltará a exigir apenas email e senha.",
      )
    ) {
      return;
    }

    this.mfaActionLoading.set(true);
    this.feedbackMessage.set("");
    this.errorMessage.set("");

    this.authService
      .disableMfa(this.mfaManageForm.getRawValue())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.mfaActionLoading.set(false);
          this.recoveryCodes.set([]);
          this.mfaSetupSecret.set(null);
          this.mfaSetupOtpAuthUrl.set(null);
          this.mfaQrCodeDataUrl.set(null);
          this.mfaManageForm.reset({ code: "" });
          this.feedbackMessage.set("MFA desativado com sucesso.");
        },
        error: (error) => {
          this.mfaActionLoading.set(false);
          this.errorMessage.set(
            error?.error?.message ?? "Não foi possível desativar o MFA.",
          );
        },
      });
  }

  protected async copyRecoveryCodes() {
    const codes = this.recoveryCodes();

    if (!codes.length || !navigator?.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(codes.join("\n"));
    this.feedbackMessage.set(
      "Códigos de recuperação copiados. Guarde-os em um gerenciador seguro.",
    );
  }

  protected async copyPendingMfaSecret() {
    const secret = this.mfaSetupSecret();

    if (!secret || !navigator?.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(secret);
    this.feedbackMessage.set("Chave secreta copiada para a área de transferência.");
  }

  protected dismissRecoveryCodes() {
    this.recoveryCodes.set([]);
  }

  protected cancelMfaSetup() {
    this.mfaSetupSecret.set(null);
    this.mfaSetupOtpAuthUrl.set(null);
    this.mfaQrCodeDataUrl.set(null);
    this.mfaSetupForm.reset({ code: "" });
  }

  protected openSupport() {
    void this.router.navigate(["/support"]);
  }

  protected selectTab(
    tab: "profile" | "finance" | "privacy" | "theme" | "account",
  ) {
    this.activeTab.set(tab);
  }

  protected setTheme(themeId: ThemeId) {
    this.themeService.setTheme(themeId);
  }

  protected isThemeActive(themeId: ThemeId) {
    return this.themeService.themeId() === themeId;
  }

  protected privacyAcceptedLabel() {
    const acceptedAt = this.authService.currentUser()?.privacyNoticeAcceptedAt;

    if (!acceptedAt) {
      return "Ainda não há aceite registrado para esta conta.";
    }

    return `Aceite registrado em ${this.formatDateTime(acceptedAt)}.`;
  }

  protected mfaStatusLabel() {
    const user = this.authService.currentUser();

    if (user?.mfaEnabled) {
      return "MFA ativo";
    }

    if (user?.mfaSetupPending || this.mfaSetupSecret()) {
      return "Configuração em andamento";
    }

    return "MFA inativo";
  }

  protected mfaLastVerifiedLabel() {
    const lastVerifiedAt = this.authService.currentUser()?.mfaLastVerifiedAt;

    if (!lastVerifiedAt) {
      return "Ainda não há uma confirmação MFA registrada.";
    }

    return `Última verificação em ${this.formatDateTime(lastVerifiedAt)}.`;
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

  private getQrCodeModule() {
    if (!this.qrCodeModulePromise) {
      this.qrCodeModulePromise = import("qrcode");
    }

    return this.qrCodeModulePromise;
  }
}
