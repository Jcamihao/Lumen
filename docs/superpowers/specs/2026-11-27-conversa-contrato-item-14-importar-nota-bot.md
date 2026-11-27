# Contrato do item 14: importar nota fiscal pelo bot (Telegram e WhatsApp) e pelos menus

Data: 2026-11-27. Status: **rascunho para o dono revisar**. Nenhum código de produção foi escrito. Branch de planejamento: `docs/bot-importar-nota` (base `develop` em `0679611`, v1.26.1). Sem push.

Convenção: **Verificado** = li o código na `develop`. **Presumido** = precisa ser provado antes de virar promessa.

## 1. Objetivo

Hoje o usuário só importa nota pela tela Importações do app. No bot, "importar nota" devolve um texto mandando abrir o app, e qualquer foto ou PDF recebe "Por aqui eu leio só texto". O item 14 faz o bot **receber a foto ou o PDF**, ler com o mesmo extrator local do item 4 (sem IA), mostrar uma prévia curta e **só gravar depois de confirmação explícita**. O menu ganha a entrada "Importar nota".

Regras que não mudam (herdadas do item 4): a nota nunca grava sozinha; leitura errada nunca passa por certa; CPF nunca é guardado; os bytes do arquivo não vão para disco nem para o banco.

## 2. Situação atual (verificado)

- `ImportsService.previewReceiptImport(userId, file: Express.Multer.File, dto)` e `commitReceiptImport(userId, dto)` fazem todo o trabalho: extrator local (`ReceiptExtractorService`), duplicata (`acknowledgeDuplicate`, 409), `ReceiptScan` com `accessKey`. O `file` é um objeto do Multer, e `tagGroupId` é obrigatório (grupo do próprio usuário).
- O extrator já limita recurso: no máximo 2 leituras simultâneas (HTTP 429 `RECEIPT_BUSY`), timeout de 30 s, imagem até 8 MB, PDF até 10 MB, 3 páginas. Erros: 422 `RECEIPT_UNREADABLE`, 409 `RECEIPT_DUPLICATE_UNCONFIRMED`.
- Motor de conversa: `matchImportReceipt` reconhece `importar nota`, `importar nota fiscal`, `ler nota`, `enviar nota` e responde `HELP` com `data.screen = 'imports'` (conversation.service.ts:601 e :691). Não abre sessão.
- O enum `ConversationState` **já tem** `AWAITING_IMPORT_FILE` e `AWAITING_IMPORT_REVIEW`, e nenhum código os usa. O comentário do schema diz que `draft` "nunca guarda conteúdo bruto de documento".
- Telegram: `parseMessage` só lê `message.text`. Mensagem sem texto vira `hasText: false` e o adaptador responde `TELEGRAM_TEXTS.media`. O cliente não tem `getFile` nem download.
- WhatsApp (WA-AKG): `handleLinked` responde `WHATSAPP_TEXTS.media` para qualquer `type !== 'text'`. O evento traz `type`, mas **não verifiquei** se o WA-AKG entrega a mídia (URL, base64 ou endpoint de download).
- Menu (`menu.tree.ts`): árvore única para os dois canais. Todas as folhas têm `action: { type: 'phrase', phrase }`. Não há nó de importação.
- Isolamento: a identidade vem do vínculo validado do canal; sessão é `@@unique([userId, channel])`.

## 3. Desenho

### 3.1 Fluxo do usuário

1. Entrada A: menu 💰 Finanças → 🧾 Importar nota, ou frase `importar nota`. O bot abre `AWAITING_IMPORT_FILE` e responde "Mande a foto ou o PDF da nota. Dica: mandar como arquivo (não como foto) lê melhor."
2. Entrada B: o usuário manda a foto ou o PDF direto, sem passar pelo menu. Vale o mesmo que a entrada A, já com o arquivo.
3. O bot baixa o arquivo, lê, grava `ReceiptScan` (`PREVIEWED`) e abre `AWAITING_IMPORT_REVIEW` com a prévia: estabelecimento, data, total, número de itens, categoria sugerida e avisos.
4. Botões (Telegram) ou "sim/não" (WhatsApp): **Lançar**, **Cancelar**, **Abrir no app** (para corrigir itens, que o bot não edita).
5. Lançar chama o commit existente. Se houver duplicata provável ou chave repetida, o bot pergunta antes: "Parece que você já lançou esta compra. Importar mesmo assim?" e só então manda `acknowledgeDuplicate: true`.
6. Divergência de soma (`totalMismatch`) ou confiança `low`: a prévia mostra o aviso e o botão vira "Lançar mesmo assim".

### 3.2 Backend

- Extrair de `previewReceiptImport` um método interno que recebe `{ buffer, fileName }` em vez do objeto do Multer. A rota HTTP e o bot chamam o mesmo núcleo. Sem duplicar regra de duplicata, privacidade ou limite.
- Novo `ReceiptConversationService` (módulo `conversation`) que cuida das duas fases da sessão e usa `ConversationEvent` (`messageId`, `appliedKey`) para idempotência: reentrega do mesmo update **não** cria segundo `ReceiptScan` nem segundo lançamento.
- O rascunho guarda só `receiptScanId`, um resumo curto para exibir e a versão. Nunca o texto da nota, itens ou bytes.
- Grupo de tags: o preview exige `tagGroupId`. Ver D2.
- Erros viram texto do bot: 422 → orientação de lançar pelo chat; 429 → "Muitas leituras agora, tente em instantes"; timeout; formato ou tamanho inválidos; mídia sem suporte (ex.: vídeo, sticker, HEIC não lido).

### 3.3 Telegram

- `parseMessage` passa a reconhecer `photo` (usar a maior variação) e `document` (só `application/pdf` e imagens), com `file_id`, `file_size` e `mime_type`. Álbum (`media_group_id`): processar só o primeiro e avisar.
- Cliente ganha `getFile` + download pela API do bot. Conferir `file_size` **antes** de baixar e respeitar os limites 8 MB (imagem) e 10 MB (PDF). Timeout de rede; arquivo só em memória.
- O token do bot e a URL de download nunca vão para log ou resposta.

### 3.4 WhatsApp

- Depende da pergunta aberta na seção 2: como o WA-AKG entrega a mídia. É a **fase 14.0b** (prova de viabilidade). Sem entrega de mídia, o WhatsApp fica só com a entrada pelo menu apontando para o app, e o resto do item vale para o Telegram.

### 3.5 Menu

- Novo nó `financas.importar` ("🧾 Importar nota", guia "ler a foto ou PDF de uma nota", exemplo "importar nota") e texto de ensino em `teaching-texts`. Acionar o nó abre `AWAITING_IMPORT_FILE`, não responde com texto de ajuda.
- No app (canal sem mídia no chat), a frase `importar nota` continua levando à tela Importações (comportamento atual).
- Atualizar `menu.tree.spec`, `menu.teaching.spec` e `teaching-texts.spec` (hoje eles fixam a árvore).

## 4. Fatias

| Fase | O que é | Saída |
|---|---|---|
| 14.0a | Contrato revisado pelo dono (este arquivo) | D1 a D6 respondidas |
| 14.0b | Prova de viabilidade da mídia no WhatsApp (WA-AKG) e no Telegram real (foto vs arquivo, tamanhos) | Relatório curto e go/no-go por canal |
| 14a | Backend: núcleo de preview por buffer, `ReceiptConversationService`, estados 1 e 2, tipos de resposta e textos | Backend verde e revisado |
| 14b | Telegram: parse de foto/PDF, `getFile`, botões de prévia | Adaptador verde e revisado |
| 14c | Menu: nó "Importar nota" nos dois canais e frase de entrada | Menu e motor verdes |
| 14d | WhatsApp: download da mídia e confirmação por texto (só se 14.0b for go) | Adaptador verde |
| 14e | Revisão de segurança, mutantes, integração real e nota de versão | Relatório e release |

Uma fase por vez; 14a define o contrato de tipos em `.superpowers/sdd/bot-importar-nota/contrato-tipos.md`. Ordem sugerida: 14.0b, 14a, 14b, 14c, 14d, 14e.

## 5. Testes e segurança

Item de segurança (arquivo enviado por usuário, dado pessoal): revisor `sonnet` obrigatório.

Matriz mínima:
- **Isolamento A/B/C:** `receiptScanId` de outro usuário nunca é lido nem confirmado pelo bot; vínculo do canal define o dono; sessão de um canal não confirma no outro.
- **Idempotência:** o mesmo update/mensagem entregue duas vezes gera um `ReceiptScan`; 100 confirmações concorrentes geram um lançamento.
- **Privacidade:** nada de bytes, texto bruto ou itens no `draft`, no log ou em `ConversationEvent`; o token do bot não aparece em log.
- **Recursos:** arquivo acima do limite recusado antes do download; terceiro processamento simultâneo recebe a mensagem de ocupado; álbum processa um só.
- **Duplicata:** sem decisão explícita não grava; chave importada por outro usuário não bloqueia nem vaza.
- **Mídia inesperada:** vídeo, áudio, sticker, contato e arquivo de tipo não suportado respondem texto claro e não abrem sessão.
- **Expiração:** sessão que expira com prévia aberta não deixa lançamento nem confirma tardio; ver D5 para o `ReceiptScan` órfão.
- **Mutantes (obrigatórios):** tirar o filtro `userId` da leitura do `receiptScanId`; pular a decisão de duplicata; gravar bytes ou texto no `draft`; trocar o limite de tamanho por sempre aceitar; remover a checagem de versão da confirmação.
- **Real:** Postgres e Redis descartáveis (portas livres, nunca as de outros projetos), bot de teste do Telegram do dono, duas contas sintéticas, notas sintéticas.
- **Não verificado (declarar no fim):** WhatsApp real, HEIC de iPhone, precisão do OCR em foto comprimida pelo Telegram.

## 6. Riscos

- **Foto comprimida:** Telegram e WhatsApp recomprimem fotos, o OCR piora. Mitigação: pedir arquivo, mostrar o aviso de divergência e oferecer "Abrir no app".
- **Capacidade do servidor:** o extrator usa 2 leituras simultâneas por processo; o bot soma tráfego. Mitigação: manter o limite e a mensagem de ocupado; sem fila nesta versão.
- **Dependência do WA-AKG:** ver 14.0b.
- **Conflito de merge:** a fase 12.2 (Tarefas, outro agente) toca `conversation.service.ts`, `intent.matcher.ts` e o menu. Combinar antes de mexer nesses arquivos.

## 7. Decisões abertas do dono

| # | Decisão | Recomendação |
|---|---|---|
| D1 | A prévia pode ser confirmada **só** por botão/"sim" (sem editar itens no bot)? | Sim. Correção de itens e categoria fica no app via "Abrir no app". |
| D2 | Qual grupo de tags o bot usa no preview, já que não há escolha na conversa? | O grupo padrão do usuário (`isDefault`), e o app continua oferecendo a troca. Se não existir, o bot orienta abrir o app. |
| D3 | O arquivo recebido no Telegram pode ser baixado e lido só em memória (sem salvar)? | Sim, igual ao app. |
| D4 | Se o WA-AKG não entregar mídia, o WhatsApp fica só com o menu apontando para o app? | Sim; o Telegram entrega tudo, e o WhatsApp entra depois. |
| D5 | `ReceiptScan` em `PREVIEWED` que nunca foi confirmado (cancelou ou expirou): apagar após quanto tempo? | Apagar em 24 horas por rotina, já que guarda dados da nota. Confirmar se isso existe hoje para o app. |
| D6 | Entra franquia de notas por plano (item 11) nesta fatia? | Não. Reavaliar quando a Família (item 13) fechar. |

## 8. Fora do escopo

Consulta à SEFAZ pelo QR, edição de itens no bot, importação de CSV pelo bot, voz, álbum com várias notas, franquia por plano e remoção do código do Selah.
