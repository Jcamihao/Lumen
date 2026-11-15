# Brief: revisão e correção do item 2b (frontend de Finanças por conversa)

Para: subagente revisor (sonnet). Relatório final em estilo curto, sem enfeite. Código, comentários e textos de tela em português do Brasil, prosa normal.
Projeto: `/home/caminhao/coding/codeStage/Lumen`.

## Papel

Você revisa E CORRIGE o frontend do item 2b, e faz o que ninguém fez ainda: **ver a tela funcionando de verdade**, com o backend real e um Chrome headless. A tela confirma lançamento de dinheiro, então a revisão é obrigatória.

## O que foi feito

Dentro da tela do Selah (`frontend/src/app/features/assistant/assistant-page/`) o usuário pode digitar comandos do assistente manual (`saldo`, `50 mercado`, `cartão`, `ajuda`...). A tela chama `POST /conversation/message` primeiro; se a resposta vem com `unrecognized: true`, cai no Selah como antes. Rascunhos mostram botões Confirmar e Cancelar. Arquivos novos: `core/models/conversation.models.ts`, `core/services/conversation-api.service.ts` (+spec), `assistant-page.component.spec.ts`. Alterados: `assistant-page.component.{ts,html,scss}`. O backend já está pronto e commitado (`backend/src/conversation/`).

Estado verificado pelo agente principal: `ng test` 228 de 228 verdes (Chrome headless, launcher `ChromeHeadlessCI`), `npm run build` sem erro. Ele corrigiu uma coisa: `crypto.randomUUID` não existe em contexto não seguro, então há um gerador de UUID v4 com fallback (`newMessageId`).

Nada do 2b está commitado. Use `git status` e `git diff` para ver o que é novo.

## Leia primeiro

1. `.superpowers/sdd/conversa-item-2b/brief.md`: o que foi pedido ao desenvolvedor, com as 7 decisões já tomadas.
2. `docs/superpowers/specs/2026-11-15-conversa-contrato-item-1.md`: contrato das rotas (seções 3, 4, 6).
3. `backend/src/conversation/conversation.types.ts`: tipos reais. Compare com `frontend/src/app/core/models/conversation.models.ts`: algum campo ou valor de `kind` divergente?
4. O diff inteiro do front.

## Checklist de revisão

A. **Contrato**: URLs, verbos e corpos de `conversation-api.service.ts` batem com o backend? Os tipos do front batem com os do back?
B. **Decisões do brief**: cada uma das 7 está cumprida? Em especial: (1) manual primeiro e Selah só com `unrecognized`; (3) turno manual nunca em `history`, `localStorage`, `NativeStorageService` nem `saveAssistantTurn`; (5) mesmo texto reenviado após falha reutiliza o `messageId`; (6) aviso só após 250 ms e envio/botões desabilitados em voo.
C. **Dinheiro**: duplo clique em Confirmar, Confirmar logo depois de Cancelar, Confirmar com `draftVersion` velho, Confirmar com a sessão expirada, rascunho trocado enquanto a tela mostra o antigo. Existe caminho em que a tela fica com botões vivos para um rascunho que já não existe, ou em que mostra "Lançado" sem ter lançado?
D. **Estados de erro**: 400, 401, 404, 429, 5xx, sem rede, resposta mal formada (sem `kind`, sem `text`). Algum deles deixa a tela travada (busy para sempre) ou lança exceção não tratada?
E. **Selah não regrediu**: consentimento de IA, limite de plano, histórico, ações, abas continuam como antes? Texto > 500 caracteres vai direto ao Selah sem chamar o manual?
F. **Segurança do front**: nenhum `innerHTML`/`bypassSecurityTrust*` novo; nada de dado financeiro em `console.log`, em URL ou em storage.
G. **Acessibilidade e UX**: `aria-live`, foco visível, alvo de toque (mínimo 44 px de altura), contraste nos dois temas, texto longo sem estourar o cartão, tela de 360 px de largura sem rolagem horizontal.
H. **Fora do escopo**: nada em `backend/`, nenhuma dependência npm nova, nenhuma rota nova.

## Teste de ponta a ponta com navegador real (obrigatório)

Suba tudo de verdade e dirija um Chrome headless.

1. **Postgres**: já está em `localhost:5433` com as migrations. Redis em `6380`. Confirme com `docker ps`; se estiverem parados, `npm run dev:infra` na raiz. Não mexa nos containers `agilis-*`.
2. **Backend**: a porta 3001 pertence a OUTRO projeto (Bora). Suba o Lumen em outra porta, por exemplo `PORT=3999`, a partir de `backend/dist` depois de `npx nest build` (`node dist/main.js` com o `.env` da raiz). Veja como o `CORS` está configurado (`APP_CORS_ALLOWED_ORIGINS`) e libere a origem do front de teste só no ambiente do processo, sem editar `.env` versionado.
3. **Frontend**: veja `frontend/src/environments/` e como `environment.apiBaseUrl` é definido. Sirva o front apontando para o backend da porta de teste SEM commitar mudança de ambiente: use um arquivo de ambiente temporário fora do que vai para o git, ou `npx ng serve` com configuração/variável própria, e desfaça tudo no final. `git diff` não pode conter mudança de `environment*.ts`.
4. **Usuários de teste**: crie dois usuários pela API de registro (veja `backend/src/auth/`; contas novas podem exigir e-mail confirmado: veja se há como confirmar em dev). Dê ao usuário A categorias de despesa "Mercado" e "Alimentação". Anote tudo o que criou para limpar depois.
5. **Chrome**: o puppeteer já tem Chrome em `~/.cache/puppeteer`. Use `puppeteer-core` ou o `puppeteer` que achar instalado em `frontend/node_modules`; se precisar instalar algo, faça FORA do repositório (em um diretório de trabalho do scratchpad) e não altere `package.json` nem `package-lock.json`. Salve scripts e capturas no diretório de scratchpad da sessão, nunca dentro do repo.

Roteiro (cada passo: passou, falhou ou não verificado, com captura quando for visual):

1. Login como A e abrir a tela do Selah.
2. Atalhos: clicar `saldo`, `resumo`, `cartão`, `ajuda`. A resposta aparece no cartão manual, com os números certos, sem pedir consentimento de IA.
3. `50 mercado` → cartão com rascunho (Valor, Descrição, Categoria, Data) e botões Confirmar e Cancelar. Clicar Confirmar duas vezes rápido: um lançamento só (confira no banco ou em `GET /transactions`). Resposta `DONE` com tom de sucesso.
4. `saldo` de novo: o saldo reflete o gasto.
5. `50 mercado` → Cancelar: nada gravado.
6. `50 mercado` → recarregar a página: o rascunho volta com botões (restauração de sessão).
7. Texto livre ("Analise meus gastos do mês"): a requisição para `/conversation/message` acontece e, como não foi reconhecido, a requisição para `/assistant/ask` também. Se o SelahIA (porta 3010) não estiver rodando, o erro do Selah é aceitável: o que importa é a chamada acontecer e o cartão manual NÃO aparecer. Para um usuário SEM consentimento de IA, o diálogo de consentimento aparece só nesse caso, nunca nos comandos do manual.
8. Valor ambíguo (`1,234 mercado`) e comando sem valor (`gastei mercado`): a conversa pede o que falta ou o erro é claro.
9. Offline (`page.setOfflineMode(true)` ou equivalente): o manual não é chamado; o fluxo offline de hoje continua.
10. Backend derrubado no meio (parar o processo): erro de rede com botão "Tentar de novo"; ao subir de novo e clicar, o mesmo `messageId` é reutilizado (veja o corpo das requisições).
11. Visual: capturas do cartão manual com rascunho em **tema claro, tema escuro, largura 390 px e largura 1280 px**. Abra as imagens (você consegue ler imagens) e julgue: alinhamento, contraste, texto cortado, botões, rolagem horizontal. Achou problema, corrija.
12. Teclado: Tab chega a Confirmar e Cancelar com foco visível; Enter aciona.

Se algo não subir, diga exatamente o que falhou e NÃO afirme que o passo passou.

## Limpeza (obrigatório)

Ao final: apague os usuários de teste e tudo o que criaram (a cascata do banco remove sessões, eventos e transações), pare todos os processos que você subiu (backend de teste, front, Chrome), remova chaves de cache do Redis que você criou, e confirme que `git status` mostra apenas os arquivos do 2b (mais os `.superpowers/` já existentes). Nenhum arquivo de ambiente alterado, nenhum token ou senha em arquivo do repo.

## Comandos de verificação (rode e relate a saída resumida)

Dentro de `frontend/`:
1. `npx ng test --watch=false --browsers=ChromeHeadlessCI`
2. `npm run build`
Na raiz, ao final: `graphify update .` (um só, nunca em paralelo).

## Regras

- Corrija direto o que achar (bug, lacuna de teste, problema visual, regressão). Contrato errado NÃO muda: registre em `.superpowers/sdd/conversa-item-2b/duvidas.md` e relate.
- Corrija só em `frontend/`. Bug no backend: não mexa, relate com o passo que reproduz.
- Todo bug que você corrigir ganha um teste que o pegaria.
- NÃO fazer commit, push, amend, reset nem deploy. Não pôr segredo em arquivo. Não mexer nos containers `agilis-*`. Não editar `.env`.

## Relatório final (curto)

1. Achados por severidade (bloqueia / corrigido / observação), cada um com `arquivo:linha`.
2. Roteiro de ponta a ponta: passos 1 a 12, cada um passou, falhou ou não verificado. Caminho completo das capturas no scratchpad.
3. Arquivos alterados por você.
4. Saída resumida dos comandos de verificação.
5. Confirmação da limpeza.
6. O que você NÃO conseguiu verificar.
