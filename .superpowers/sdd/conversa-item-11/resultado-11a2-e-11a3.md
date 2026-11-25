# 11a-2 e 11a-3 — app de grupo e venda do Compartilhado (item 11, fechamento da 11a)

Sessão Qwen única, 2026-11-24, árvore principal `Lumen`, dono ausente com autorização total ("pode fazer tudo... nao precisa me perguntar nada"). Contrato: `docs/superpowers/specs/2026-11-24-conversa-contrato-item-11.md`.

## 11a-2 — app (branch `feat/billing-grupos-11a2`, commit `20ce226`, merge `c32aee5`)
- `domain.models`: `creditCards` entrou em `LimitedResource` (a linha "Cartões" do uso existia mas o catálogo 11a-1 agora devolve o limite — FREE 1 / Individual 5 / Compartilhado 10, D7); `BillingMe.group` (`{role, ownerFirstName}`); `GroupView` (dono: membros, convites, lugares; membro: só primeiro nome + desde quando).
- `BillingService`: os 6 endpoints do 11a-1 (`loadGroup`, `createGroupInvite`, `revokeGroupInvite`, `acceptGroupInvite`, `leaveGroup`, `removeGroupMember`).
- `/plano` (bloco "Membros", sem rota nova, D10): pagador vê `X de Y lugares usados`, lista de membros com remover (confirmação em duas etapas), convites pendentes com revogar, formulário de convite por e-mail; o link de convite (`/plano?convite=<token>`) aparece UMA vez com botão copiar (área de transferência com fallback de "copie manualmente"). Membro vê "Plano Compartilhado de <primeiro nome>" + "sai do grupo" só com confirmação; nenhum controle de convite e nenhum dado dos outros. `?convite=` na chegada faz o aceite e mostra toast (sucesso com o primeiro nome; erro com a mensagem uniforme do backend, D12).
- Descoberta registrada (dono, ao voltar): todo usuário já nasce com o cartão "Principal" — o limite FREE de 1 cartão (D7) já nasce ocupado; o SHARED chega a 10 contando com ele.

### Incidentes de teste (karma) corrigidos na própria fatia
- `window.confirm` sem espião TRAVA e derruba o karma (headless não tem diálogo nativo) — spy antes do clique, como o teste do Cancelar já fazia.
- `dispatchEvent(new Event('submit'))` sem `{cancelable: true}` navega a página e derruba a suíte.
- Fake de erro HTTP só com `subscribe` artesanal não passa pelo `pipe(takeUntilDestroyed)` — usar `throwError` do RxJS.
- Karma focado 33/33, inteiro **427/427**, `ng build` ok. Mutantes da fatia: **7/7 mortos** (um precisou virar `role === 'owner'` porque a versão `&& false` quebrava a compilação — mutante de build não conta; o script `~/tmp-lumen/mutantes-11a2.sh` restaura por backup e o sha1 final confere com o baseline).

## 11a-3 — venda do Compartilhado (esta branch, com o fechamento)
- `plans.catalog.ts`: `SHARED.sellable = true` (D8 — o interruptor, com comentário do dono). Checkout já recusava não-vendável; só a flag mudou.
- Backend: spec do catálogo passou a exigir `sellable: true`; o teste de recusa do checkout mudou de SHARED para FREE com **asserção pela mensagem** (só o 400 não diferenciava do preço ausente — mutante pegou isso de primeira); teste novo: checkout SHARED mensal chega no Asaas com `value 24.9` e `cycle MONTHLY` (preço do grupo, não por pessoa).
- App: `subscribe(plan, interval)` generalizado; FREE vê 4 botões (Individual e Compartilhado, mensal/anual); `checkout` do service aceita `SHARED`; landing ganha o card "Compartilhado" quando o catálogo libera (preço formatado, "para 2 pessoas" lido de `seats`, CTA igual aos outros = `/auth/register`).
- Karma focado 40/40 → inteiro **429/429**; `ng build` ok; backend `tsc` limpo e **91 suítes / 2342** verdes.
- Mutantes da fatia: **4/4 mortos** (flag do catálogo, guard do checkout — morto só depois de reforçar a asserção da mensagem, botão SHARED que assinava o Individual, card da landing que chumbava os lugares).

### Integração real (descartável Postgres 18.6 + Redis 8, portas 5546/6392, backend com `BILLING_ENABLED=true` e Asaas dummy apontando pra porta fechada)
- **Achado de ambiente**: a porta 3000 ficou ocupada pelo container `orquestrador-ia-server-1` (projeto de outra pessoa) — o primeiro teste bateu 404 nele; o Lumen descartável passou para a porta 3100. Nenhum container alheio foi tocado.
- Roteiro `~/tmp-lumen/integrar-11a3.sh` + `integracao-11a3.mjs` (idempotente, banco limpo na corrida final): catálogo público com SHARED vendável/2 lugares/preço 24.90–249/FREE não-vendável; checkout FREE barrado na porta de entrada; checkout SHARED passa pelo gate e cai no Asaas dummy (prova que a flag liberou a venda); grant SHARED → dono convida → aceite → efetivo SHARED do membro com só o primeiro nome → convite extra criado mas **aceite do terceiro cai 409** (convite não reserva assento — comportamento decidido na 11a-1) → sair devolve ao FREE. Resultado final: **17 checagens × 1 corrida com banco limpo, 0 falhas** (a corrida anterior teve 15/16 e a única "falha" era a checagem do meu script cobrando do backend uma reserva de lugar que a 11a-1 decidiu existir só no aceite; corrigi o roteiro, não o backend).

## Não verificado (aceito, registrar para o dono)
- **Checkout real no Asaas**: nada foi testado contra a Asaas de verdade (chaves do dono). A integração prova até a porta do gate de venda. Antes de vender de verdade: rodar um checkout SHARED em produção-teste com o preço certo na página hospedada.
- Copiar link em navegador real (clipboard API), visual do bloco Membros em tela estreita, tema escuro do card novo da landing.
- A venda do SHARED está LIGADA no código (`sellable: true`); em produção ela só existe de fato com `BILLING_ENABLED=true` + chaves Asaas — nada disso foi ligado por esta sessão.
