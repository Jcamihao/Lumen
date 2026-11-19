# Integração real do item 7 — fallback de IA por plano

Data: 2026-11-19. Conferido pelo: agente principal.

## Ambiente (descartável, removido no fim)

- Postgres 16 em 55461 e Redis 7 em 56411 via `docker run --rm` (imagens locais), banco novo com as 27 migrations do repositório aplicadas por `prisma migrate deploy` e `prisma migrate diff` sem diferença (o enum novo com os 3 valores nasceu no banco real).
- Backend de teste em 3998 (`node dist/main.js`, `BILLING_ENABLED=true`, contas Grátis), SelahIA falso em 3110 gravando cada payload recebido em arquivo de hits. Portas conferidas livres com `ss -ltn` antes e sem listener depois da limpeza (contêineres parados, nenhum `lumen7*` restante).
- 3 contas sintéticas: A e B com consentimento de IA, C sem consentimento. Scripts de seed/driver em `/tmp` (removidos; continham credencial sintética local e por isso nunca entraram no repositório).

## Cenários executados (35 checagens, todas PASS)

1. **Respondido (A)**: texto livre → HTTP 200, `kind INFO`, `aiFallback: true`, `state IDLE`, sem `unrecognized`; 1 chamada ao Selah; evento único `ai_fallback/AI_ANSWERED`; crédito cobrado exatamente 1x.
2. **Isolamento A×B**: payload enviado ao Selah contém marca da conta A e nenhuma marca de B (é o teste do "prompt de fallback isolado" exigido pela revisão do item 6 — o caminho não leva chave/ferramenta de escrita, só o contexto de leitura do dono).
3. **Reentrega do mesmo `messageId`**: `DUPLICATE`, sem nova chamada ao Selah, sem evento extra.
4. **Bloqueio por plano (A)**: com as 5 perguntas do Grátis consumidas, o 6º texto livre → HELP com texto de limite, zero chamadas ao Selah, evento `AI_BLOCKED`, crédito inalterado em 5.
5. **Isolamento B**: payload só com a marca de B, sem nada de A.
6. **Sem consentimento (C)**: HELP contextual, zero chamadas externas, evento `AI_BLOCKED`, crédito zero.
7. **IA com erro (fake 500)**: HELP "A IA está indisponível agora", evento `AI_UNAVAILABLE`, nenhum crédito cobrado, resposta não inventada.
8. **Modo `off`**: comportamento antigo preservado — HELP com `unrecognized: true`, evento `UNRECOGNIZED`, zero chamadas externas.

## NÃO verificado (integração)

- WhatsApp de ponta a ponta com WA-AKG real no fallback (o motor é o mesmo e o formatador tem teste unitário; adaptação real do canal ficou coberta nos itens 5/6).
- Indicador de digitação no WhatsApp (fora de escopo, contrato §5).
- Rate limit do `POST /conversation/message` com a chamada de IA de até 15 s em voo.
- Múltiplas instâncias do backend: a trava anti-reentrega em voo é por processo (limitação registrada no relatório de revisão).
- SelahIA real (o teste usou o falso local).

## Verde desta etapa (com data e quem conferiu)

- 2026-11-19, agente principal: backend `tsc` limpo, suíte completa 62 suites / 1683 testes; `conversation+assistant+whatsapp+billing` 879 testes em TZ=UTC, America/Sao_Paulo e Asia/Tokyo; frontend `tsc` (app+spec) limpo, build ok, karma 355 testes. Revisor sonnet: 62 mutantes (51 mortos de primeira, 10 viraram testes e morreram, 1 equivalente documentado). Revisão do haiku: 868 testes nas suítes afetadas. Integração real: 35/35 checagens acima.
