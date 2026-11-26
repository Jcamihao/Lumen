# Integracao real da escrita natural (12.0b) — rodada em 2026-11-25 pela sessao Qwen

Contexto: as tres fatias da 12.0b rodaram "sem Docker, por pedido do dono" (relatorios das fatias). A nota `docs/releases/v1.24.0.md` afirmou "Integracao real em Docker na 12.0b-1" — **incorreto**, corrigido nesta sessao. O HANDOFF de 2026-11-25 pedia "rodar a integracao Docker da 12.0b-2 com a maquina livre"; foi rodada no descartavel padrao da casa (bins Postgres 18.6/Redis 8 em 5546/6392, backend real 3100 com `BILLING_ENABLED=true` e Asaas dummy; mesma qualidade de ambiente das integracoes do item 8/9/11, sem Docker por causa do calor do notebook do dono).

Roteiro: `/home/caminhao/tmp-lumen/integrar-12-0b.sh` + `integracao-12-0b.mjs` (o motor de conversa e multi-turno: o script responde as perguntas de campo — descricao, categoria, cartao, primeiro vencimento — ate a previsao de confirmacao; banco conferido por psql).

## Resultado: 41 checagens, 0 falhas
- Despesa natural ("foi 35 no uber") em dialogue fechado: previsao neutra SEM emoji, confirmar grava 1 EXPENSE 35.00.
- Receita alegre ("caiu 500 do freela"): exatamente 1 emoji; grava INCOME 500.00.
- Negativos com estado limpo: "foi 35 no uber?" / "nao gastei 50..." / "se eu gastar 50..." nao abrem escrita; banco sem nada.
- Caixinha com exatamente 1 meta: "coloquei 200 na minha caixinha" confirma com ela, celebrando com 1 emoji; aporte vira TRANSFER 200.00 e `Goal.currentAmount` sobe; "minhas caixinhas" lista.
- Palavra sensivel ("conta do hospital") FORCA neutro ate em guardar (sem emoji).
- Parcelado natural ponta a ponta: "comprei um celular em 10x de 150" → previsao com 10 parcelas/total 1.500,00/1a data; banco: 1 `InstallmentPurchase` 1500.00/10 com lancamentos gerados = `installmentsGenerated` (>=1).
- Cartao pelo nome ("gastei 50 no nubank"): previsao menciona o Nubank; banco CREDIT com o `cardId` do Nubank.
- "passei 200 no credito" com 2 cartoes **pergunta qual** (como o contrato 12.0b manda: "sem nome, pergunta qual, como hoje"); resposta "principal" grava CREDIT com o cardId do padrao.
- Data relativa: "50 de gasolina ontem" grava com `date` = ontem.
- Cancelar nao grava; rascunho de outro usuario: B nao confirma o de A (nada gravado), A confirma o seu, e o segredo so existe para A.
- **100 confirmacoes concorrentes do mesmo rascunho = 1 lancamento 33.30** (a checagem que faltava do contrato).
- Variante de tom: 6 receitas identicas com messageIds diferentes produziram **mais de uma variante** (deterministica por messageId).
- Isolamento de lista: "minhas caixinhas" de B so mostra a meta de B.

## O que a rodada revelou (comportamento correto, mas antes so visto em unit)
- O motor pede DESCRICAO como campo pendente quando a frase nao traz uma extrainvel ("gastei 50 no nubank") — esperado dos 3b1, o integrador anterior nao tinha chegado ate aqui.
- Com 2+ cartoes, "no credito" sem nome pergunta o cartao em vez de gravar sem cardId (paridade com o contrato 9b/12.0b).

## Continua NAO verificado
- Fluxo pelo adaptador Telegram real (Bot API falsa) desta vez nao — o engine coberto acima e o mesmo dos adaptadores, e o par Telegram falso ja foi exercitado no fechamento do item 10; a lacuna especifica da 12.0b (texto do tom saindo pelo adaptador) segue so em unit tests do formatador ate o teste com bot real que e do dono.
- WhatsApp com as frases naturais: idem (mesmo motor, adaptador nao exercitado).
