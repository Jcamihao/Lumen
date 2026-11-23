import { HttpClient } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { Observable } from "rxjs";
import { environment } from "../../../environments/environment";
import {
  ConversationReply,
  ConversationSessionView,
} from "../models/conversation.models";

/**
 * Assistente manual (canal APP). Sem fallback offline: quem chama decide o que
 * mostrar quando não há rede. Não guarda nada no navegador.
 */
@Injectable({ providedIn: "root" })
export class ConversationApiService {
  private readonly http = inject(HttpClient);

  private get baseUrl() {
    return `${environment.apiBaseUrl}/conversation`;
  }

  sendMessage(messageId: string, text: string): Observable<ConversationReply> {
    return this.http.post<ConversationReply>(`${this.baseUrl}/message`, {
      messageId,
      text,
    });
  }

  /** `remove` só vai no corpo quando é apagar de vez (botão do cartão de apagar). Sem ele, o corpo não tem `delete`. */
  confirmDraft(draftId: string, draftVersion: number, remove = false): Observable<ConversationReply> {
    return this.http.post<ConversationReply>(`${this.baseUrl}/confirm`, {
      draftId,
      draftVersion,
      ...(remove ? { delete: true as const } : {}),
    });
  }

  cancelDraft(draftId: string): Observable<ConversationReply> {
    return this.http.post<ConversationReply>(`${this.baseUrl}/cancel`, { draftId });
  }

  getSession(): Observable<ConversationSessionView> {
    return this.http.get<ConversationSessionView>(`${this.baseUrl}/session`);
  }
}
