# Resultado 9b-3b: criar cartao pela conversa (com pergunta do fechamento)

Data: 2026-11-24. Branch: feat/cartoes-no-bot (sem troca). Brief: .superpowers/sdd/cartoes-no-bot-9b/brief-9b3b.md.
Implementado por Claude Haiku 5.5 (agente implementador, sessao unica). Revisao sonnet: NAO feita nesta fatia.
Conferencia independente do agente principal: pendente.
Decisao do dono (2026-11-24, "A"): o bot PERGUNTA o dia de fechamento antes de confirmar (duvida 7 resolvida).

## Comportamento
- "criar/novo/adicionar/cadastrar cartao <nome>" valida nome (vazio, > 40, igual a cartao ativo sem caixa/acento) e teto de 10 ativos ANTES do rascunho. Recusa sem rascunho e sem gravar.
- Dias na frase: "fecha dia 10" / "fechamento 10" (fechamento) e "vence dia 17" / "vencimento 17" (vencimento, opcional). "dia" e opcional.
- Sem fechamento na frase: rascunho CARD_CREATE com campo pendente closingDay. Pergunta: "Qual o dia de fechamento do <nome> (1 a 31)?".
  - Resposta so o numero ("10" ou "dia 10"). Invalida ("40", "0", "abc") repete a pergunta sem sair do rascunho.
- Fechamento invalido na frase ("fecha dia 40") ou sem numero ("fecha") recusa sem rascunho (nada gravado).
- Resumo: "Criar o cartao <nome>. Fecha: dia X (ou a informar). Vence: dia Y (ou sem vencimento). Nao sera o cartao padrao." Tela: linhas Cartao, Fechamento, Vencimento, Padrao "nao".
- Confirmar grava por CreditCardsService.create (mesmo caminho da API, sem regra nova). Cartao nunca vira padrao (create ja grava isDefault false).
- Recibo: "Cartao <nome> criado, fecha dia X" (+ ", vence dia Y" quando houver). data.cardId.
- Reconferencia sob o lock do servico: nome tomado -> "Ja existe..." (texto proprio, nada gravado); teto atingido entre rascunho e confirmacao (422) -> texto de teto; falha antes do commit -> rascunho mantido, pode confirmar de novo; resultado desconhecido (CreditCardWriteUncertainError) -> writeUncertain, sem repetir.
- Gate Telegram/WhatsApp (TELEGRAM_WRITES_ENABLED) continua no caminho comum de confirmacao.
- Recusa antiga ("ainda nao esta disponivel") REMOVIDA, com seus testes e texto. Renomear intacto.
- Sem schema, sem migration. Fora: arquivar, padrao, vencimento por pergunta.

## Mudancas de codigo
- backend/src/conversation/card-write.ts: parseCardCreate, parseClosingDayAnswer, cardCreateDraftText, cardCreatedText; textos de criar; createUnavailable removido.
- backend/src/conversation/conversation.types.ts: DraftKind 'CARD_CREATE', interface CardCreateDraft, PendingField 'closingDay', SessionDraft.
- backend/src/conversation/conversation.service.ts: startCardCreateDraft, applyCardCreate, answerCardCreate; ramos em handleWithoutSession, answerPending, applyByKind, questionFor, confirmationText, toDraftView, discardText (422 -> teto, 409 -> nome tomado), saveFailedText, numberedOptions, startsWithNumericAnswer; import MAX_ACTIVE_CARDS_PER_USER.
- backend/src/conversation/parsers/intent.matcher.ts: sem mudanca (create_card ja trazia o corpo; a frase com dias passa pelo mesmo matcher).
- Testes: card-write.spec.ts (parser, resposta, textos, bordas 1/31), card-write.service.spec.ts (bloco antigo de recusa substituido por 19 casos de criar), parsers/intent.matcher.card-write.spec.ts (frases com dias, "criar cartao" sem nome), isolation.fixture.ts (spyOn em create).
- Duvidas: item 7 marcado como resolvido.

## Comandos e numeros (2026-11-24)
- cd backend && npx tsc --noEmit: exit 0.
- npx jest src/conversation src/credit-cards src/transactions src/telegram --maxWorkers=2, 36 suites: TZ=UTC, America/Sao_Paulo e Asia/Tokyo: 1168 testes verdes cada (antes desta fatia: 1113).
- npx jest --maxWorkers=2 (suite inteira, TZ=UTC): 90 suites, 2295 testes verdes.
- Specs novos (card-write e intent.matcher.card-write) repetidos 15 vezes seguidas: 15 verdes, 0 falhas.
- graphify update . (raiz): ok (6161 nos, 13692 arestas, 346 comunidades).

## Mutantes (17; alvo: card-write, service de criar, matcher, conversation.service.spec)
Mortos 17, sobreviventes 0, equivalentes 0.
- M1 duplicata de palavra (fecha 2x) aceita: morto. M2 dia 0 aceito na resposta: morto. M3 dia 32 aceito na resposta: morto.
- M4 dia 31 recusado na frase: sobrevivente na 1a rodada; morto apos teste de borda (dia 1 e 31).
- M5 nome de 41 aceito no parser: morto. M6 vencimento sumido do recibo: morto. M7 nameTakenBy sem normalizacao: morto (5 falhas).
- M8 teto com > em vez de >=: morto. M9 nome tomado nao checado na abertura: morto. M10 nome tomado nao checado na confirmacao: morto.
- M11 422 sem texto de teto no descarte: morto. M12 pendingField nao zerado ao responder: morto. M13 dueDay nao enviado ao create: morto.
- M14 CARD_CREATE sem roteamento na confirmacao: morto POR ERRO DE COMPILACAO (TS: o ramo cai em applyTransaction), nao por teste de comportamento. Na 1a rodada o classificador nao contou falha de suite e marcou sobrevivente; reclassificado.
- M15 Padrao "sim" na tela: morto. M16 falha antes do commit sem restaurar: morto.
- M17 resposta com digito sem o caminho startsWithNumericAnswer: morto. Nao era equivalente: "10" pura vira despesa pelo matcher. Teste "10" adicionado.
- Metodo: os mutantes foram aplicados por substituicao exata no arquivo (ancora unica) e o original foi regravado no fim (sem git checkout). Conferido ao final: arquivos iguais ao salvo.

## Limitacoes aceitas (registrar, nao redescobrir)
- Nome que contem as palavras "fecha", "fechamento", "vence" ou "vencimento" (ex.: "Cartao Vence Bem") nao cria: o nome termina na primeira dessas palavras e o resto vira palavra desconhecida (recusa). Dono nao decidiu; hoje so cria pela tela.
- Dia invalido na frase recusa (nao pergunta). Pergunta so quando o dia de fechamento nao veio.

## NAO verificado
- Revisao sonnet e conferencia independente do agente principal: NAO feitas.
- Banco real (Postgres e Redis descartaveis) e Docker: NAO feitos (brief: sem Docker nesta fatia). A corrida de nome e de teto foi testada com CreditCardsService real sobre fake de Prisma, nao com lock do banco. Teto 10 entre rascunho e confirmacao simulado por insercao no fake.
- Resultado desconhecido: simulado com mock do create (CreditCardWriteUncertainError), nao por queda real no commit.
- Trava do Telegram LIGADA: nao testada (so desligada). WhatsApp com criar cartao: nao testado.
- Frontend: DraftView.kind do app (frontend/src/app/core/models/conversation.models.ts) nao tem 'CARD_CREATE' nem 'CARD_RENAME'. Tela e 9c; nada tocado no frontend.
- Lint/prettier: NAO aplicados. Os arquivos ja falham no prettier --check em HEAD e o projeto nao tem config de prettier; nao reformatei para nao gerar ruido.
- Ordem da lista de cartoes em ambiguidade: o fake nao aplica orderBy.

## Commits (ordem)
- feat(conversa): criar cartao pela conversa com pergunta do fechamento (9b-3b)
- test(conversa): criar cartao pela conversa (9b-3b)
- docs(9b): resultado da 9b-3b e duvida 7 resolvida

## Proximos passos
1. Revisao sonnet com Postgres/Redis descartaveis e mutantes (fatia 9b-3b inteira) e conferencia independente do agente principal.
2. Frontend: incluir CARD_CREATE no tipo DraftView.kind (9c).
3. Dono: decidir se nome com "fecha/vence" deve ser aceito (limitacao acima).
4. Depois: merge na develop (--no-ff) e atualizar o handoff. Nao feito nesta fatia.
