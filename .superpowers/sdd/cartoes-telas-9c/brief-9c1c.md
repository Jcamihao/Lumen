# Brief 9c-1c: limpar teto por cartao (rota + tela) (branch feat/cartoes-telas-9c; NUNCA troque de branch)

Decisao do dono (2026-11-24, "sim"): criar DELETE /credit-cards/:id/ceiling e o botao de limpar na tela.

Leia ANTES: CLAUDE.md, ~/.claude/CLAUDE.md, docs/superpowers/specs/2026-11-24-conversa-contrato-item-9c.md, .superpowers/sdd/cartoes-telas-9c/{resultado-9c1b,resultado-revisao-9c1b}.md, backend/src/credit-cards/credit-cards.controller.ts e service, backend/src/credit-cycle/credit-cycle.service.ts (setCeiling por cartao, removeCeilingForConversation e a guarda de conflito/ciclo), frontend credit-cycle-card (teto por aba da 9c-1b).

## Escopo (so isto)
1. Backend: DELETE /credit-cards/:id/ceiling. Cartao do usuario autenticado (404 igual para alheio/inexistente; cartao arquivado: mesma regra do PUT ceiling). Remove o teto do ciclo vigente do cartao pela MESMA regra e lock do removeCeilingForConversation (ordem de locks: User -> cartao -> teto; sem regra duplicada: extraia/reuse um metodo comum). Recibo do que foi removido (valor antigo, fim do ciclo). Sem teto vigente: 409 com texto claro ou 200 idempotente como o motor ja decide (siga o motor). Swagger atualizado. Sem schema/migration.
2. Frontend: botao "Limpar teto" na aba (so quando ha teto, online, 2+ cartoes; e no cartao padrao tambem se ja ha o botao de teto), confirmacao em 2 etapas (Confirmar/Cancelar, Esc cancela), estados salvando/erro, erro de rede = resultado desconhecido sem nova tentativa (mesmo padrao do Salvar), recarrega o ciclo apos sucesso, textos em portugues.
3. Nao mexa em mais nada.

## Testes
Backend jest (controller/service: ok, 404 alheio, arquivado, sem teto, conflito, isolamento A/B/C, ordem de locks como nos testes existentes), frontend karma. Mutantes >= 8 proprios (mortos/sobreviventes/equivalentes; cubra sobreviventes). Rode: cd backend && npx tsc --noEmit && npx jest src/credit-cards src/credit-cycle src/conversation --maxWorkers=2 nos 3 fusos (TZ=UTC, America/Sao_Paulo, Asia/Tokyo); cd frontend && ng build e ng test (se o Chrome nao subir: apt-get download libnspr4 libnss3 libasound2t64, dpkg -x numa pasta do scratchpad, LD_LIBRARY_PATH; apague no fim); graphify update . na raiz.

## Regras
Comentarios em portugues sem acentos no codigo. Clean Code/Clean Architecture no padrao do projeto. Fale curto (caveman). NAO toque nos containers lumen-postgres-1, lumen-redis-1, wa-akg-db, detect-objects nem nas portas 5433, 6380, 3306, 8000; sem Docker nesta fatia. Commits separados com caminhos explicitos (feat; test; docs), Conventional Commits em portugues, Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>. Nunca amend/reset/push. Duvida de produto: duvidas.md, nao decida. Termine com .superpowers/sdd/cartoes-telas-9c/resultado-9c1c.md (mudancas, comandos e numeros, mutantes, NAO verificado). Nao pergunte nada.
