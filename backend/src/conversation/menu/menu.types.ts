import type { ConversationChannel } from '@prisma/client';

/** Acao de uma folha do menu: frase que o motor ja entende, ou resposta com a instrucao pronta. */
export type MenuAction = { type: 'phrase'; phrase: string } | { type: 'instruction'; text: string };

/** No da arvore: grupo tem filhos; folha tem acao e frase de exemplo (usada na lista e na dica). */
export interface MenuNode {
  id: string;
  title: string;
  example?: string;
  children?: MenuNode[];
  action?: MenuAction;
}

/** Forma do menu para o canal desenhar (botoes no Telegram, lista no texto). */
export interface MenuView {
  nodeId: string;
  title: string;
  options: Array<{ id: string; label: string }>;
  backId?: string;
  topId?: string;
}

/** Clique de botao (ou entrada equivalente) vindo do adaptador. Identidade sempre do vinculo, nunca do clique. */
export interface MenuActionInput {
  userId: string;
  channel: ConversationChannel;
  messageId: string;
  nodeId: string;
  receivedAt: Date;
}
