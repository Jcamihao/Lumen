import { HttpClient } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { Observable } from "rxjs";
import { environment } from "../../../environments/environment";
import { TelegramLinkCode, TelegramStatus } from "../models/telegram.models";

/**
 * Vínculo de Telegram da conta logada. Sem cache, sem fallback offline e sem
 * nada no navegador: o código de vínculo nunca é guardado aqui.
 */
@Injectable({ providedIn: "root" })
export class TelegramApiService {
  private readonly http = inject(HttpClient);

  private get baseUrl() {
    return `${environment.apiBaseUrl}/telegram`;
  }

  getStatus(): Observable<TelegramStatus> {
    return this.http.get<TelegramStatus>(`${this.baseUrl}/status`);
  }

  createLinkCode(): Observable<TelegramLinkCode> {
    return this.http.post<TelegramLinkCode>(`${this.baseUrl}/link-code`, {});
  }

  unlink(): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/link`);
  }
}
