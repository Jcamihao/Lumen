import { HttpClient } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { Observable } from "rxjs";
import { environment } from "../../../environments/environment";
import { WhatsappLinkCode, WhatsappStatus } from "../models/whatsapp.models";

/**
 * Vínculo de WhatsApp da conta logada. Sem cache, sem fallback offline e sem
 * nada no navegador: o código de vínculo nunca é guardado aqui.
 */
@Injectable({ providedIn: "root" })
export class WhatsappApiService {
  private readonly http = inject(HttpClient);

  private get baseUrl() {
    return `${environment.apiBaseUrl}/whatsapp`;
  }

  getStatus(): Observable<WhatsappStatus> {
    return this.http.get<WhatsappStatus>(`${this.baseUrl}/status`);
  }

  createLinkCode(): Observable<WhatsappLinkCode> {
    return this.http.post<WhatsappLinkCode>(`${this.baseUrl}/link-code`, {});
  }

  unlink(): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/link`);
  }
}
