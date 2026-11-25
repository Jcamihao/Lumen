# Duvidas e decisoes do subagente 5a (backend WhatsApp)

Itens que o brief deixou em aberto ou que pedem confirmacao do dono. Nenhum muda o contrato; a leitura adotada esta marcada.

1. **Endereco do app na resposta de midia.** O brief pede "mandar usar a tela de Importacoes do app com o endereco do app". Nao ha URL publica fixa no codigo. Adotei texto sem URL: "Notas e arquivos sao enviados pela tela de Importacoes do app do Lumen." Se o dono quiser o link, falta a URL de producao (hoje existe so `APP_URL`).
2. **Webhook responde antes do envio.** O controller devolve `200 {"ok":true}` e processa em seguida (`void this.adapter.handleInbound`). Motivo: limite de 10 s do WA-AKG, sem reentrega. `handleInbound` nunca lanca, entao nao ha promise rejeitada sem tratamento.
3. **Midia de numero sem vinculo.** O brief nao diz o que fazer. Adotei silencio (nenhuma resposta, nenhum motor).
4. **Falha no meio do envio de partes.** Se a parte 1 sai e a 2 falha, as seguintes nao sao enviadas. Loga so o numero mascarado e o motivo (`http 503`, `timeout`).
5. **Comando "desvincular whatsapp".** Comparado depois de trim, minusculas e espacos colapsados. Sem tratamento de acento.
6. **Coluna `WhatsappLinkCode.failedAttempts`.** RESOLVIDO na revisao: coluna removida do schema, da migration original e do contrato (a contagem de falhas fica no Redis, `whatsapp:linkfail:<hash>`, janela de 10 min).
7. **Frase "importar nota".** Nao ha tratamento especial no adaptador; a resposta vem do motor (`import_receipt`). Nao verifiquei o texto exato que o motor devolve no canal WhatsApp.
8. **Migration.** Conferida contra Postgres 16 descartavel (container temporario, porta 55432, removido ao fim): `prisma migrate diff --from-migrations ... --to-schema-datamodel ... --script` deu "This is an empty migration". Nao usei o Postgres da porta 5432.

---

# Duvidas do 5c (integracao real)

## 9. [Decisao do dono] "Confirme no app" nao funciona para o rascunho feito pelo WhatsApp

Achado na integracao real (front + backend + Postgres + Redis, Chrome). Com `WHATSAPP_WRITES_ENABLED=false`, o "confirmar" pelo WhatsApp responde "Para gravar, confirme no app: abra o assistente e toque em Confirmar." Mas o assistente do app so mostra o rascunho do canal APP: `GET /conversation/session` le `loadSession(userId, ConversationChannel.APP)` (`conversation.service.ts`, `getSession`). Resultado verificado: com o rascunho "50 mercado" pendente na sessao WHATSAPP, `GET /conversation/session` devolveu `{"state":"IDLE"}` e a aba Assistente nao mostrou nenhum cartao. O usuario nao consegue tocar em Confirmar naquele rascunho; so pode digitar de novo no app.

O que ja funciona: `POST /conversation/confirm` com `draftId`/`draftVersion` da sessao WHATSAPP grava (`confirmDraft` busca por `id` + `userId`, sem filtrar canal). Provei por API: gravou 1 transacao no usuario certo.

Nao mudei nada porque e mudanca de contrato (rota/resposta) ou de texto contratado. Opcoes:

- **A (recomendada):** `GET /conversation/session` passa a devolver o rascunho pendente mais recente do usuario em qualquer canal (APP primeiro, senao WHATSAPP). Front nao muda (ja restaura o cartao e confirma por `draftId`). Por que: cumpre o que a mensagem promete, sem inventar rota. Cuidado: o isolamento continua por `userId`; precisa teste A/B e a revisao do item 6.
- **B:** trocar o texto do WhatsApp para algo verdadeiro ("Para gravar, envie este mesmo texto no assistente do app e toque em Confirmar") e deixar a escrita pelo WhatsApp como unica via ate o item 6. Menor, mas pior experiencia.

Enquanto nao decidir: em producao a escrita pelo WhatsApp fica desligada (D2), entao o usuario cai nesse texto.

## 10. [Observacao, sem acao] Formato da data no rascunho

Na pergunta de categoria a data aparece como `18/11/2026`; no rascunho final, como `2026-11-18`. Vem do motor, nao do adaptador. Cosmetico.
