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
