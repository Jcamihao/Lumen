import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  OnInit,
  signal,
} from "@angular/core";
import { HttpErrorResponse } from "@angular/common/http";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { catchError, EMPTY, exhaustMap, interval, Subscription } from "rxjs";
import { ToastService } from "../../../core/services/toast.service";
import { WhatsappApiService } from "../../../core/services/whatsapp-api.service";
import { WhatsappLinkCode, WhatsappStatus } from "../../../core/models/whatsapp.models";

type CardState = "loading" | "unavailable" | "error" | "unlinked" | "linked";
type RetryAction = "status" | "code" | "unlink";

const CONSENT_FIRST =
  "Ao vincular, você conversa com o Lumen pelo WhatsApp. O Lumen usa uma conexão não oficial com o WhatsApp, um canal de terceiros: o texto das suas mensagens passa por ele.";
const CONSENT_SECOND =
  "Por enquanto, pelo WhatsApp o Lumen só monta rascunhos e consulta; para lançar de fato, confirme no app. Você pode desvincular quando quiser.";
const UNAVAILABLE_TEXT = "O WhatsApp ainda não está disponível nesta conta.";
const GENERIC_ERROR = "Não foi possível agora. Tente de novo.";
const RATE_LIMIT_ERROR = "Muitos códigos gerados. Tente de novo em uma hora.";
const COPY_OK = "Código copiado.";
const COPY_FAILED = "Não foi possível copiar. Selecione o código e copie manualmente.";
const TICK_MS = 1000;
const POLL_MS = 5000;

/** Soletra o código para leitor de tela: "K 7 M 2 Q X 9 P". */
export function spellCode(code: string): string {
  return code.split("").join(" ");
}

/** "K7M2QX9P" -> "K7M2-QX9P". */
export function splitCode(code: string): string {
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/**
 * Telefone para exibir: "+5511912345678" -> "+55 11 91234-5678".
 * Formato não reconhecido volta sem alteração.
 */
export function formatPhone(raw: string): string {
  const text = raw.trim();
  // Só dígitos e separadores de telefone; qualquer outra coisa sai como veio.
  if (!/^\+?[\d\s()-]+$/.test(text)) return raw;
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(text.replace(/\D/g, ""));
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : raw;
}

function statusOf(err: unknown): number {
  return err instanceof HttpErrorResponse ? err.status : 0;
}

@Component({
  selector: "app-whatsapp-card",
  imports: [],
  templateUrl: "./whatsapp-card.component.html",
  styleUrls: ["./whatsapp-card.component.scss"],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WhatsappCardComponent implements OnInit {
  private readonly api = inject(WhatsappApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly consentFirst = CONSENT_FIRST;
  readonly consentSecond = CONSENT_SECOND;
  readonly unavailableText = UNAVAILABLE_TEXT;

  readonly state = signal<CardState>("loading");
  readonly status = signal<WhatsappStatus | null>(null);
  readonly code = signal<WhatsappLinkCode | null>(null);
  readonly codeExpired = signal(false);
  readonly now = signal(Date.now());
  readonly busy = signal(false);
  readonly confirmingUnlink = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly retryAction = signal<RetryAction | null>(null);
  readonly copyMessage = signal<string | null>(null);

  readonly formattedCode = computed(() => splitCode(this.code()?.code ?? ""));
  readonly spelledCode = computed(() => spellCode(this.code()?.code ?? ""));
  readonly expiresLabel = computed(() => {
    const iso = this.code()?.expiresAt;
    return iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
  });
  readonly minutesLeft = computed(() => {
    const iso = this.code()?.expiresAt;
    if (!iso) return 0;
    return Math.max(0, Math.ceil((Date.parse(iso) - this.now()) / 60000));
  });
  readonly destinationLabel = computed(() => {
    const number = this.status()?.contactNumber?.trim();
    return number ? formatPhone(number) : "o número do Lumen";
  });
  readonly maskedNumber = computed(() => this.status()?.maskedNumber ?? "");
  readonly linkedSince = computed(() => {
    const iso = this.status()?.linkedAt;
    return iso ? new Date(iso).toLocaleDateString("pt-BR") : "";
  });

  private tickSub: Subscription | null = null;
  private pollSub: Subscription | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.stopCodeTimers();
      this.code.set(null);
    });
  }

  ngOnInit(): void {
    this.loadStatus();
  }

  loadStatus(): void {
    this.state.set("loading");
    this.errorMessage.set(null);
    this.retryAction.set(null);
    this.api
      .getStatus()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => this.applyStatus(s),
        error: (err: unknown) => this.handleError(err, "status"),
      });
  }

  generateCode(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.errorMessage.set(null);
    this.retryAction.set(null);
    this.api
      .createLinkCode()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (c) => {
          this.busy.set(false);
          // Resposta atrasada: se o cartão já saiu de "não vinculado", o código não vale.
          if (this.state() !== "unlinked") return;
          this.codeExpired.set(false);
          this.copyMessage.set(null);
          this.code.set(c);
          this.startCodeTimers();
          this.focusAfterRender("code");
        },
        error: (err: unknown) => {
          this.busy.set(false);
          this.handleError(err, "code");
        },
      });
  }

  async copyCode(): Promise<void> {
    const value = this.code()?.code;
    if (!value) return;
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
    if (!clipboard) {
      this.copyMessage.set(COPY_FAILED);
      return;
    }
    try {
      await clipboard.writeText(value);
      this.copyMessage.set(COPY_OK);
    } catch {
      this.copyMessage.set(COPY_FAILED);
    }
  }

  askUnlink(): void {
    this.confirmingUnlink.set(true);
    this.focusAfterRender("confirm-unlink");
  }

  cancelUnlink(): void {
    this.confirmingUnlink.set(false);
    this.focusAfterRender("unlink");
  }

  confirmUnlink(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.errorMessage.set(null);
    this.retryAction.set(null);
    this.api
      .unlink()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.confirmingUnlink.set(false);
          this.stopCodeTimers();
          this.clearCode();
          this.status.update((s) =>
            s ? { ...s, linked: false, linkedAt: undefined, maskedNumber: undefined } : s,
          );
          this.state.set("unlinked");
          this.toast.success("WhatsApp desvinculado");
          this.focusAfterRender("generate");
        },
        error: (err: unknown) => {
          this.busy.set(false);
          this.handleError(err, "unlink");
        },
      });
  }

  retry(): void {
    switch (this.retryAction()) {
      case "status":
        this.loadStatus();
        break;
      case "code":
        this.generateCode();
        break;
      case "unlink":
        this.confirmUnlink();
        break;
      default:
        break;
    }
  }

  private applyStatus(s: WhatsappStatus): void {
    this.status.set(s);
    if (!s.enabled) {
      this.stopCodeTimers();
      this.clearCode();
      this.state.set("unavailable");
      return;
    }
    if (s.linked) {
      this.stopCodeTimers();
      this.clearCode();
      this.state.set("linked");
      return;
    }
    this.state.set("unlinked");
  }

  private handleError(err: unknown, action: RetryAction): void {
    const status = statusOf(err);
    if (status === 503) {
      this.stopCodeTimers();
      this.clearCode();
      this.state.set("unavailable");
      return;
    }
    if (action === "code" && status === 409) {
      // Já vinculado em outra tela ou aba: a verdade vem do servidor.
      this.loadStatus();
      return;
    }
    if (action === "code" && status === 429) {
      this.errorMessage.set(RATE_LIMIT_ERROR);
      this.retryAction.set(null);
      return;
    }
    if (action === "status") {
      this.state.set("error");
    }
    this.errorMessage.set(GENERIC_ERROR);
    this.retryAction.set(action);
  }

  private startCodeTimers(): void {
    this.stopCodeTimers();
    this.tickSub = interval(TICK_MS).subscribe(() => this.onTick());
    this.pollSub = interval(POLL_MS)
      .pipe(
        // exhaustMap: não abre requisição nova enquanto a anterior não voltou.
        exhaustMap(() =>
          this.api.getStatus().pipe(
            catchError((err: unknown) => {
              // Falha passageira: tenta no próximo ciclo (o prazo do código limita o total).
              if (statusOf(err) === 503) this.handleError(err, "status");
              return EMPTY;
            }),
          ),
        ),
      )
      .subscribe((s) => this.onPoll(s));
  }

  private stopCodeTimers(): void {
    this.tickSub?.unsubscribe();
    this.pollSub?.unsubscribe();
    this.tickSub = null;
    this.pollSub = null;
  }

  private onTick(): void {
    this.now.set(Date.now());
    const iso = this.code()?.expiresAt;
    if (iso && Date.parse(iso) <= this.now()) {
      this.expireCode();
    }
  }

  private onPoll(s: WhatsappStatus): void {
    if (!this.code()) return;
    if (!s.enabled) {
      this.applyStatus(s);
      return;
    }
    this.status.set(s);
    if (s.linked) {
      this.stopCodeTimers();
      this.clearCode();
      this.state.set("linked");
      this.toast.success("WhatsApp vinculado");
    }
  }

  private expireCode(): void {
    this.stopCodeTimers();
    this.clearCode();
    this.codeExpired.set(true);
  }

  /** Devolve o foco a um controle que acabou de sair ou entrar na tela, para não cair no <body>. */
  private focusAfterRender(target: "code" | "generate" | "unlink" | "confirm-unlink"): void {
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>(`[data-focus="${target}"]`)?.focus(),
      { injector: this.injector },
    );
  }

  private clearCode(): void {
    this.code.set(null);
    this.codeExpired.set(false);
    this.copyMessage.set(null);
  }
}
