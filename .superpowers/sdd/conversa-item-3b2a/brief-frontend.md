# Brief de implementação frontend: item 3b2a

Data: 2026-11-15. Estado: preparado, ainda não implementado.
Projeto: `/home/caminhao/coding/codeStage/Lumen`.

O dono aprovou o contrato do 3b2. Nesta entrega, o chat ganha reservas e limite do cartão; o cartão genérico de linhas do 3b1 já existe. O objetivo é espelhar tipos e validar os novos fluxos sem criar outra tela.

## Leia primeiro

Leia integralmente `/home/caminhao/.claude/CLAUDE.md`, `contrato-tipos.md` desta pasta e o contrato aprovado `docs/superpowers/specs/2026-11-15-conversa-contrato-item-3b2.md`. O principal deve confirmar que o backend entrega os tipos combinados antes desta etapa. Uma dúvida de integração vai para `duvidas.md` e para o principal; não corrigir backend neste trabalho.

## Mudanças permitidas

- `frontend/src/app/core/models/conversation.models.ts`: acrescentar `ENVELOPE` e `CREDIT_LIMIT` a `DraftKind`, `name` a `PendingField` e `envelopeId?: string` a `ReplyData`. Não acrescentar ainda os tipos de contas fixas ou parcelados.
- `frontend/src/app/features/assistant/assistant-page/assistant-page.component.ts`: rótulo `name` igual a "nome". Outras mudanças somente para corrigir um fluxo demonstrável desta entrega.
- `assistant-page.component.spec.ts`: regressões abaixo.
- `assistant-page.component.html` e `.scss` somente se os testes reais mostrarem uma necessidade; preferir reutilizar `rows`, título, avisos e botões existentes.

## Testes obrigatórios

1. Reserva em coleta de nome restaurada: linhas com `a informar`, rótulo nome e nenhum botão Confirmar.
2. Reserva completa: título, nome, valor mensal, mês UTC e aviso de provisão visíveis; não desenhar `null` nem campos de lançamento duplicados.
3. Limite completo: ciclo, teto atual, novo teto e aviso de validade por ciclo. Opção de todas as formas exibe o segundo aviso.
4. Nova resposta de confirmação com `draftVersion` maior substitui o cartão anterior. O próximo clique envia exatamente o novo id/versão.
5. `DONE` de limite com `data: {}` e `DONE` de reserva com `envelopeId` não dependem de `data.card` para exibir sucesso.
6. `ERROR`/`IDLE` sem draft para commit desconhecido remove confirmação anterior e não oferece retry de gravação. Não confundir com falha de transporte, que mantém o comportamento de reentrega pelo mesmo `messageId` já contratado.
7. Duplo clique, cancelamento, reload, foco visível e Enter permanecem funcionando. Compatibilidade com respostas antigas sem `rows` e com metas/aportes/lançamentos anteriores.

Não guardar rascunhos ou mensagens financeiras em console, histórico, localStorage ou sessionStorage. Não mudar os fluxos de consentimento ou fallback de IA. Manter identidade visual do app, sem cores ou fontes novas.

## Verificação e entrega

Rodar `npx ng test --watch=false --browsers=ChromeHeadlessCI` e `npm run build` dentro de `frontend/`. Comparar resultados com a última referência documentada de 248 testes; ela é histórica, não evidência de uma execução nova.

Registrar arquivos alterados, resultado dos comandos e limitações. Integração real contra o backend, capturas em claro/escuro e mobile/desktop e limpeza são exigências da revisão seguinte. Sem commit, push, deploy, dependência nova ou alteração de ambiente. Não rodar graphify simultaneamente com outro agente; o principal faz a atualização final.
