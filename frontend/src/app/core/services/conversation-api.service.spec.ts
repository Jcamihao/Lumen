import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { environment } from "../../../environments/environment";
import { ConversationApiService } from "./conversation-api.service";

describe("ConversationApiService", () => {
  let service: ConversationApiService;
  let httpMock: HttpTestingController;
  const base = `${environment.apiBaseUrl}/conversation`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ConversationApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it("sendMessage faz POST em /message com messageId e text", () => {
    service.sendMessage("8d1c2f7e-0000-4000-8000-000000000001", "50 mercado").subscribe();

    const req = httpMock.expectOne(`${base}/message`);
    expect(req.request.method).toBe("POST");
    expect(req.request.body).toEqual({
      messageId: "8d1c2f7e-0000-4000-8000-000000000001",
      text: "50 mercado",
    });
    req.flush({ kind: "HELP", state: "IDLE", text: "" });
  });

  it("confirmDraft faz POST em /confirm com draftId e draftVersion", () => {
    service.confirmDraft("draft-1", 2).subscribe();

    const req = httpMock.expectOne(`${base}/confirm`);
    expect(req.request.method).toBe("POST");
    expect(req.request.body).toEqual({ draftId: "draft-1", draftVersion: 2 });
    req.flush({ kind: "DONE", state: "IDLE", text: "" });
  });

  it("cancelDraft faz POST em /cancel só com draftId", () => {
    service.cancelDraft("draft-1").subscribe();

    const req = httpMock.expectOne(`${base}/cancel`);
    expect(req.request.method).toBe("POST");
    expect(req.request.body).toEqual({ draftId: "draft-1" });
    req.flush({ kind: "CANCELLED", state: "IDLE", text: "" });
  });

  it("getSession faz GET em /session", () => {
    let result: unknown;
    service.getSession().subscribe((session) => (result = session));

    const req = httpMock.expectOne(`${base}/session`);
    expect(req.request.method).toBe("GET");
    req.flush({ state: "IDLE" });
    expect(result).toEqual({ state: "IDLE" });
  });
});
