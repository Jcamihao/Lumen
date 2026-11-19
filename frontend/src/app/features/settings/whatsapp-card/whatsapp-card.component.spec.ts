import { HttpErrorResponse } from "@angular/common/http";
import { ComponentFixture, discardPeriodicTasks, fakeAsync, flushMicrotasks, TestBed, tick } from "@angular/core/testing";
import { of, Subject, throwError } from "rxjs";
import { WhatsappLinkCode, WhatsappStatus } from "../../../core/models/whatsapp.models";
import { ToastService } from "../../../core/services/toast.service";
import { WhatsappApiService } from "../../../core/services/whatsapp-api.service";
import { formatPhone, WhatsappCardComponent } from "./whatsapp-card.component";

const MIN = 60 * 1000;
const UNLINKED: WhatsappStatus = { enabled: true, linked: false, contactNumber: "+5511912345678" };
const LINKED: WhatsappStatus = {
  enabled: true,
  linked: true,
  linkedAt: "2026-11-10T12:00:00.000Z",
  maskedNumber: "+55 11 *****-1234",
  contactNumber: "+5511912345678",
};

function code(expiresInMs = 10 * MIN): WhatsappLinkCode {
  return { code: "K7M2QX9P", expiresAt: new Date(Date.now() + expiresInMs).toISOString() };
}

function httpError(status: number, body: unknown = null): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: body });
}

describe("WhatsappCardComponent", () => {
  let fixture: ComponentFixture<WhatsappCardComponent>;
  let api: jasmine.SpyObj<WhatsappApiService>;
  let toast: jasmine.SpyObj<ToastService>;

  function setup(): void {
    fixture = TestBed.createComponent(WhatsappCardComponent);
  }

  function render(): HTMLElement {
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? "";
  }

  function findButton(label: string): HTMLButtonElement | undefined {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll("button"),
    ).find((b) => b.textContent?.trim() === label);
  }

  function clickButton(label: string): void {
    const btn = findButton(label);
    if (!btn) throw new Error(`botão não encontrado: ${label}`);
    btn.click();
    fixture.detectChanges();
  }

  beforeEach(() => {
    api = jasmine.createSpyObj<WhatsappApiService>("WhatsappApiService", [
      "getStatus",
      "createLinkCode",
      "unlink",
    ]);
    toast = jasmine.createSpyObj<ToastService>("ToastService", ["success", "error", "show"]);
    api.getStatus.and.returnValue(of(UNLINKED));
    TestBed.configureTestingModule({
      imports: [WhatsappCardComponent],
      providers: [
        { provide: WhatsappApiService, useValue: api },
        { provide: ToastService, useValue: toast },
      ],
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("mostra carregando enquanto o status não chega", () => {
    api.getStatus.and.returnValue(new Subject<WhatsappStatus>().asObservable());
    setup();
    render();
    expect(text()).toContain("Carregando...");
    expect(findButton("Gerar código de vínculo")).toBeUndefined();
  });

  it("mostra desligado pelo servidor quando enabled=false, sem botão", () => {
    api.getStatus.and.returnValue(of({ enabled: false, linked: false }));
    setup();
    render();
    expect(text()).toContain("O WhatsApp ainda não está disponível nesta conta.");
    expect(fixture.nativeElement.querySelectorAll("button").length).toBe(0);
  });

  it("mostra desligado pelo servidor quando status responde 503", () => {
    api.getStatus.and.returnValue(throwError(() => httpError(503, { code: "WHATSAPP_DISABLED" })));
    setup();
    render();
    expect(text()).toContain("O WhatsApp ainda não está disponível nesta conta.");
    expect(fixture.nativeElement.querySelectorAll("button").length).toBe(0);
  });

  it("não vinculado mostra o consentimento antes do botão", () => {
    setup();
    render();
    const consent = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll("p")).find((p) =>
      p.textContent?.includes("Ao vincular"),
    );
    const button = findButton("Gerar código de vínculo");
    expect(consent).toBeDefined();
    expect(button).toBeDefined();
    expect(consent!.compareDocumentPosition(button!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(text()).toContain("passa por ele");
  });

  it("gerar código mostra o código formatado, soletrado, o prazo e o número de contato", () => {
    api.createLinkCode.and.returnValue(of(code()));
    setup();
    render();
    clickButton("Gerar código de vínculo");

    expect(api.createLinkCode).toHaveBeenCalledTimes(1);
    expect(text()).toContain("K7M2-QX9P");
    const value = (fixture.nativeElement as HTMLElement).querySelector(".whatsapp-card__code-value");
    expect(value?.getAttribute("aria-label")).toBe("K 7 M 2 Q X 9 P");
    expect(text()).toMatch(/Vale até \d{2}:\d{2}/);
    expect(text()).toContain("Envie este código, só ele, no WhatsApp para +55 11 91234-5678.");
    // Em 360 px o número do Lumen não pode quebrar no meio.
    const dest = (fixture.nativeElement as HTMLElement).querySelector(".whatsapp-card__number");
    expect(dest?.textContent).toBe("+55 11 91234-5678");
    fixture.destroy();
  });

  it("sem contactNumber a instrução cita o número do Lumen", () => {
    api.getStatus.and.returnValue(of({ enabled: true, linked: false }));
    api.createLinkCode.and.returnValue(of(code()));
    setup();
    render();
    clickButton("Gerar código de vínculo");
    expect(text()).toContain("no WhatsApp para o número do Lumen.");
    fixture.destroy();
  });

  it("copiar com sucesso usa navigator.clipboard", fakeAsync(() => {
    const writeText = jasmine.createSpy("writeText").and.resolveTo();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    api.createLinkCode.and.returnValue(of(code()));
    setup();
    render();
    clickButton("Gerar código de vínculo");
    clickButton("Copiar");
    flushMicrotasks();
    fixture.detectChanges();

    expect(writeText).toHaveBeenCalledWith("K7M2QX9P");
    expect(text()).toContain("Código copiado.");
    discardPeriodicTasks();
    fixture.destroy();
  }));

  it("copiar com falha mostra mensagem de falha", fakeAsync(() => {
    const writeText = jasmine.createSpy("writeText").and.rejectWith(new Error("negado"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    api.createLinkCode.and.returnValue(of(code()));
    setup();
    render();
    clickButton("Gerar código de vínculo");
    clickButton("Copiar");
    flushMicrotasks();
    fixture.detectChanges();

    expect(text()).toContain("Não foi possível copiar.");
    expect(text()).not.toContain("Código copiado.");
    discardPeriodicTasks();
    fixture.destroy();
  }));

  it("expiração troca para código expirado e oferece gerar novo", fakeAsync(() => {
    api.createLinkCode.and.returnValue(of(code(MIN)));
    setup();
    render();
    clickButton("Gerar código de vínculo");

    tick(MIN + 1000);
    fixture.detectChanges();

    expect(text()).toContain("Código expirado.");
    expect(text()).not.toContain("K7M2-QX9P");
    expect(findButton("Gerar novo código")).toBeDefined();
    discardPeriodicTasks();
    fixture.destroy();
  }));

  it("polling detecta o vínculo, mostra toast e para", fakeAsync(() => {
    api.getStatus.and.returnValues(of(UNLINKED), of(LINKED));
    api.createLinkCode.and.returnValue(of(code()));
    setup();
    render();
    clickButton("Gerar código de vínculo");
    expect(api.getStatus).toHaveBeenCalledTimes(1);

    tick(5000);
    fixture.detectChanges();

    expect(api.getStatus).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledWith("WhatsApp vinculado");
    expect(text()).toContain("WhatsApp vinculado: +55 11 *****-1234");
    expect(text()).not.toContain("K7M2-QX9P");

    tick(20000);
    expect(api.getStatus).toHaveBeenCalledTimes(2);
    fixture.destroy();
  }));

  it("polling para ao destruir o componente", fakeAsync(() => {
    api.createLinkCode.and.returnValue(of(code()));
    setup();
    render();
    clickButton("Gerar código de vínculo");
    const before = api.getStatus.calls.count();

    fixture.destroy();
    tick(30000);

    expect(api.getStatus.calls.count()).toBe(before);
  }));

  it("desvincular pede confirmação em duas etapas e cancelar volta", () => {
    api.getStatus.and.returnValue(of(LINKED));
    setup();
    render();
    clickButton("Desvincular");

    expect(findButton("Confirmar desvínculo")).toBeDefined();
    expect(findButton("Cancelar")).toBeDefined();
    expect(api.unlink).not.toHaveBeenCalled();

    clickButton("Cancelar");
    expect(findButton("Desvincular")).toBeDefined();
    expect(api.unlink).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it("confirmar desvínculo chama DELETE, volta a não vinculado e avisa", () => {
    api.getStatus.and.returnValue(of(LINKED));
    api.unlink.and.returnValue(of(undefined));
    setup();
    render();
    clickButton("Desvincular");
    clickButton("Confirmar desvínculo");

    expect(api.unlink).toHaveBeenCalledTimes(1);
    expect(text()).toContain("Nenhum WhatsApp vinculado a esta conta.");
    expect(toast.success).toHaveBeenCalledWith("WhatsApp desvinculado");
    fixture.destroy();
  });

  it("409 ao gerar recarrega o status e não mostra código", () => {
    api.createLinkCode.and.returnValue(throwError(() => httpError(409, { code: "WHATSAPP_ALREADY_LINKED" })));
    setup();
    render();
    api.getStatus.and.returnValue(of(LINKED));
    clickButton("Gerar código de vínculo");

    expect(api.getStatus).toHaveBeenCalledTimes(2);
    expect(text()).toContain("WhatsApp vinculado: +55 11 *****-1234");
    expect(text()).not.toContain("Muitos códigos");
    // O número mascarado fica em um span sem quebra de linha (não parte em "+55 11" / "*****-1234").
    const masked = (fixture.nativeElement as HTMLElement).querySelector(".whatsapp-card__number");
    expect(masked?.textContent).toBe("+55 11 *****-1234");
    fixture.destroy();
  });

  it("429 mostra mensagem de limite sem botão de tentar de novo", () => {
    api.createLinkCode.and.returnValue(throwError(() => httpError(429)));
    setup();
    render();
    clickButton("Gerar código de vínculo");

    expect(text()).toContain("Muitos códigos gerados. Tente de novo em uma hora.");
    expect(findButton("Tentar de novo")).toBeUndefined();
    fixture.destroy();
  });

  it("erro genérico mostra texto fixo, nunca o corpo bruto, e Tentar de novo refaz a chamada", () => {
    api.createLinkCode.and.returnValue(throwError(() => httpError(500, { message: "vazamento-interno" })));
    setup();
    render();
    clickButton("Gerar código de vínculo");

    expect(text()).toContain("Não foi possível agora. Tente de novo.");
    expect(text()).not.toContain("vazamento-interno");

    api.createLinkCode.and.returnValue(of(code()));
    clickButton("Tentar de novo");
    expect(api.createLinkCode).toHaveBeenCalledTimes(2);
    expect(text()).toContain("K7M2-QX9P");
    fixture.destroy();
  });

  it("falha ao carregar status mostra Tentar de novo que recarrega", () => {
    api.getStatus.and.returnValue(throwError(() => httpError(500)));
    setup();
    render();
    expect(text()).toContain("Não foi possível agora. Tente de novo.");

    api.getStatus.and.returnValue(of(UNLINKED));
    clickButton("Tentar de novo");
    expect(api.getStatus).toHaveBeenCalledTimes(2);
    expect(findButton("Gerar código de vínculo")).toBeDefined();
    fixture.destroy();
  });

  it("botão fica desabilitado durante a chamada e não duplica o clique", () => {
    const pending = new Subject<WhatsappLinkCode>();
    api.createLinkCode.and.returnValue(pending.asObservable());
    setup();
    render();
    clickButton("Gerar código de vínculo");

    const busy = findButton("Gerando...");
    expect(busy?.disabled).toBe(true);
    busy?.click();
    expect(api.createLinkCode).toHaveBeenCalledTimes(1);

    pending.next(code());
    pending.complete();
    fixture.detectChanges();
    expect(text()).toContain("K7M2-QX9P");
    fixture.destroy();
  });

  it("o consentimento diz que a conexão é não oficial e que o texto passa por terceiros", () => {
    setup();
    render();
    expect(text()).toContain("não oficial");
    expect(text()).toContain("canal de terceiros");
    expect(text()).toContain("Você pode desvincular quando quiser.");
  });

  it("ao ver o vínculo pelo polling o código sai do estado do componente", fakeAsync(() => {
    api.getStatus.and.returnValues(of(UNLINKED), of(LINKED));
    api.createLinkCode.and.returnValue(of(code()));
    setup();
    render();
    clickButton("Gerar código de vínculo");
    expect(fixture.componentInstance.code()).not.toBeNull();

    tick(5000);
    expect(fixture.componentInstance.code()).toBeNull();
    fixture.destroy();
  }));

  it("ao expirar o código sai do estado do componente", fakeAsync(() => {
    api.createLinkCode.and.returnValue(of(code(MIN)));
    setup();
    render();
    clickButton("Gerar código de vínculo");

    tick(MIN + 1000);
    expect(fixture.componentInstance.code()).toBeNull();
    discardPeriodicTasks();
    fixture.destroy();
  }));

  it("ao destruir o código sai do estado do componente", fakeAsync(() => {
    api.createLinkCode.and.returnValue(of(code()));
    setup();
    render();
    clickButton("Gerar código de vínculo");
    const component = fixture.componentInstance;

    fixture.destroy();
    expect(component.code()).toBeNull();
  }));

  it("o código nunca vai para localStorage nem sessionStorage", () => {
    api.createLinkCode.and.returnValue(of(code()));
    setup();
    render();
    clickButton("Gerar código de vínculo");

    const dump = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(dump).not.toContain("K7M2QX9P");
    expect(dump).not.toContain("K7M2-QX9P");
    fixture.destroy();
  });

  it("falha ao desvincular mantém o cartão vinculado e oferece Tentar de novo", () => {
    api.getStatus.and.returnValue(of(LINKED));
    api.unlink.and.returnValue(throwError(() => httpError(500, { message: "vazamento-interno" })));
    setup();
    render();
    clickButton("Desvincular");
    clickButton("Confirmar desvínculo");

    expect(text()).toContain("WhatsApp vinculado: +55 11 *****-1234");
    expect(text()).not.toContain("Nenhum WhatsApp vinculado");
    expect(text()).toContain("Não foi possível agora. Tente de novo.");
    expect(text()).not.toContain("vazamento-interno");
    expect(toast.success).not.toHaveBeenCalledWith("WhatsApp desvinculado");

    api.unlink.and.returnValue(of(undefined));
    clickButton("Tentar de novo");
    expect(api.unlink).toHaveBeenCalledTimes(2);
    expect(text()).toContain("Nenhum WhatsApp vinculado a esta conta.");
    fixture.destroy();
  });

  it("no estado vinculado não há botão de gerar código", () => {
    api.getStatus.and.returnValue(of(LINKED));
    setup();
    render();
    expect(findButton("Gerar código de vínculo")).toBeUndefined();
    clickButton("Desvincular");
    expect(findButton("Gerar código de vínculo")).toBeUndefined();
    fixture.destroy();
  });

  it("resposta atrasada do código é descartada se o cartão já não está em não vinculado", () => {
    const pending = new Subject<WhatsappLinkCode>();
    api.createLinkCode.and.returnValue(pending.asObservable());
    setup();
    render();
    clickButton("Gerar código de vínculo");

    api.getStatus.and.returnValue(of(LINKED));
    fixture.componentInstance.loadStatus();
    pending.next(code());
    pending.complete();
    fixture.detectChanges();

    expect(fixture.componentInstance.code()).toBeNull();
    expect(text()).toContain("WhatsApp vinculado: +55 11 *****-1234");
    expect(text()).not.toContain("K7M2-QX9P");
    fixture.destroy();
  });

  it("polling não abre requisição nova enquanto a anterior não voltou", fakeAsync(() => {
    const slow = new Subject<WhatsappStatus>();
    api.getStatus.and.returnValues(of(UNLINKED), slow.asObservable());
    api.createLinkCode.and.returnValue(of(code()));
    setup();
    render();
    clickButton("Gerar código de vínculo");

    tick(15000);
    expect(api.getStatus).toHaveBeenCalledTimes(2);
    slow.complete();
    discardPeriodicTasks();
    fixture.destroy();
  }));

  it("gerar novo código depois de expirar não empilha polling", fakeAsync(() => {
    api.createLinkCode.and.returnValues(of(code(MIN)), of(code()));
    setup();
    render();
    clickButton("Gerar código de vínculo");
    tick(MIN + 1000);
    fixture.detectChanges();
    clickButton("Gerar novo código");

    const before = api.getStatus.calls.count();
    tick(5000);
    expect(api.getStatus.calls.count() - before).toBe(1);
    discardPeriodicTasks();
    fixture.destroy();
  }));

  it("503 durante o polling troca para desligado e para de consultar", fakeAsync(() => {
    api.getStatus.and.returnValues(of(UNLINKED), throwError(() => httpError(503)));
    api.createLinkCode.and.returnValue(of(code()));
    setup();
    render();
    clickButton("Gerar código de vínculo");

    tick(5000);
    fixture.detectChanges();
    expect(text()).toContain("O WhatsApp ainda não está disponível nesta conta.");
    expect(fixture.componentInstance.code()).toBeNull();

    const count = api.getStatus.calls.count();
    tick(20000);
    expect(api.getStatus.calls.count()).toBe(count);
    fixture.destroy();
  }));

  it("copiar sem navigator.clipboard avisa e não quebra", fakeAsync(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    api.createLinkCode.and.returnValue(of(code()));
    setup();
    render();
    clickButton("Gerar código de vínculo");
    clickButton("Copiar");
    flushMicrotasks();
    fixture.detectChanges();

    expect(text()).toContain("Não foi possível copiar.");
    discardPeriodicTasks();
    fixture.destroy();
  }));

  it("o foco acompanha a confirmação do desvínculo e a geração do código", () => {
    api.getStatus.and.returnValue(of(LINKED));
    api.unlink.and.returnValue(of(undefined));
    setup();
    render();

    clickButton("Desvincular");
    expect(document.activeElement).toBe(findButton("Confirmar desvínculo") ?? null);
    clickButton("Cancelar");
    expect(document.activeElement).toBe(findButton("Desvincular") ?? null);

    clickButton("Desvincular");
    clickButton("Confirmar desvínculo");
    expect(document.activeElement).toBe(findButton("Gerar código de vínculo") ?? null);

    api.createLinkCode.and.returnValue(of(code()));
    clickButton("Gerar código de vínculo");
    expect((document.activeElement as HTMLElement | null)?.getAttribute("aria-label")).toBe("K 7 M 2 Q X 9 P");
    fixture.destroy();
  });
});

describe("formatPhone", () => {
  it("formata números brasileiros com DDI", () => {
    expect(formatPhone("+5511912345678")).toBe("+55 11 91234-5678");
    expect(formatPhone("5511912345678")).toBe("+55 11 91234-5678");
    expect(formatPhone("+55 (11) 91234-5678")).toBe("+55 11 91234-5678");
    expect(formatPhone("+551134567890")).toBe("+55 11 3456-7890");
  });

  it("devolve cru o que não reconhece, sem inventar dígitos", () => {
    for (const raw of ["", "   ", "11912345678", "+14155550123", "abc5511912345678", "+55119123456789012", "+5511"]) {
      expect(formatPhone(raw)).toBe(raw);
    }
  });
});
