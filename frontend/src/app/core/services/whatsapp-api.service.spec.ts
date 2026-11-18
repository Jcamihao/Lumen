import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { environment } from "../../../environments/environment";
import { WhatsappApiService } from "./whatsapp-api.service";

describe("WhatsappApiService", () => {
  let service: WhatsappApiService;
  let httpMock: HttpTestingController;
  const base = `${environment.apiBaseUrl}/whatsapp`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(WhatsappApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it("getStatus faz GET em /status", () => {
    let result: unknown;
    service.getStatus().subscribe((s) => (result = s));

    const req = httpMock.expectOne(`${base}/status`);
    expect(req.request.method).toBe("GET");
    req.flush({ enabled: true, linked: false });
    expect(result).toEqual({ enabled: true, linked: false });
  });

  it("createLinkCode faz POST em /link-code sem corpo", () => {
    service.createLinkCode().subscribe();

    const req = httpMock.expectOne(`${base}/link-code`);
    expect(req.request.method).toBe("POST");
    expect(req.request.body).toEqual({});
    req.flush({ code: "K7M2QX9P", expiresAt: "2026-11-18T12:10:00.000Z" });
  });

  it("unlink faz DELETE em /link", () => {
    service.unlink().subscribe();

    const req = httpMock.expectOne(`${base}/link`);
    expect(req.request.method).toBe("DELETE");
    req.flush(null, { status: 204, statusText: "No Content" });
  });
});
