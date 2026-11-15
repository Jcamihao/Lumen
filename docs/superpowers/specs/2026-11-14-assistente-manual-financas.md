# Assistente manual — Finanças por conversa

Data: 2026-11-14  
Status: contrato de produto confirmado pelo dono; implementação pendente.

## Objetivo

O assistente do Lumen deve permitir operar a área de Finanças por conversa, tanto no aplicativo quanto no WhatsApp. O mesmo motor interpreta intenções, consulta dados e prepara ações; cada canal só adapta entrada e saída.

O assistente manual é a fonte de verdade para toda ação. LLM, quando existir no plano Inteligente, só explica texto livre e nunca grava dados por conta própria.

## Escopo funcional

### Consultar (sem confirmação)

- saldo, entradas, saídas e resumo do mês;
- gastos por categoria e por período;
- limite do ciclo, usado e disponível do cartão, com fechamento e vencimento (hoje o Lumen tem um cartão por usuário, via `CreditCycleService.getCurrent`);
- compras parceladas abertas e próximo impacto;
- contas fixas e próximos vencimentos;
- metas e reservas: valor atual, alvo, falta, prazo e progresso;
- gastos recorrentes ativos e próxima ocorrência;
- notas importadas, itens, preço histórico e comparações;
- insights determinísticos: variação mensal, categoria que subiu, compra recorrente e alerta de orçamento.

### Criar (sempre com confirmação)

- lançamento de despesa ou receita;
- meta, reserva e aporte;
- gasto recorrente;
- compra parcelada;
- conta fixa;
- limite do cartão no ciclo atual (`CreditCycleService.setCeiling`);
- orçamento/limite de categoria;
- rascunho de importação de nota fiscal.

### Alterar e encerrar (fase seguinte, mas parte do objetivo)

- editar ou excluir lançamento;
- ajustar limite de cartão;
- pausar, reativar ou encerrar recorrência;
- editar, concluir ou cancelar meta/reserva;
- editar ou cancelar parcelado e conta fixa.

Essas ações só podem ocorrer depois de o bot mostrar o item exato encontrado e pedir confirmação. A primeira versão não aceita “apaga tudo”, nem edição baseada em suposição.

### Fora do escopo da primeira versão: vários cartões

Decisão do dono em 2026-11-15: o Lumen terá vários cartões nomeados, mas depois. Hoje existe um cartão por usuário (`CreditCycleCeiling` e `User.monthClosingDay`/`creditDueDay`), sem nome. Quando os vários cartões existirem como feature de Finanças, o assistente passa a aceitar o nome do cartão ("limite do Nubank"). Até lá, nenhum comando do bot cria ou nomeia cartão.

## Catálogo de conversas por domínio

| Domínio | Exemplos | Resultado esperado |
|---|---|---|
| Panorama | `saldo`, `resumo`, `quanto gastei?` | Dados consolidados do período atual, sem linguagem inventada. |
| Gastos | `50 mercado`, `gastei 32,90 na farmácia` | Rascunho de despesa com valor, categoria e data; confirmação antes de gravar. |
| Receitas | `recebi 800 de freelance` | Rascunho de entrada; confirmação antes de gravar. |
| Cartão | `quanto sobrou no cartão?`, `limite do cartão`, `definir limite 2 mil` | Consulta de limite disponível/fechamento/vencimento ou rascunho de novo limite do ciclo. |
| Parcelados | `minhas parcelas`, `parcelar 600 em 6 vezes` | Lista ou rascunho com total, quantidade, primeira data e cartão. |
| Contas fixas | `o que vence?`, `internet 120 todo dia 10` | Vencimentos próximos ou rascunho de conta recorrente. |
| Recorrências | `gasto recorrente`, `academia 90 todo mês` | Lista ou rascunho de recorrência. |
| Metas e reservas | `criar meta viagem 3 mil`, `como está minha reserva?` | Progresso ou rascunho de meta/reserva e aporte. |
| Orçamentos | `limite de mercado`, `definir 800 para alimentação` | Leitura de uso ou rascunho de limite de categoria. |
| Importação | `importar nota`, foto/PDF da nota | Rascunho de nota; nunca cria lançamento definitivo sem revisão. |
| Itens de nota | `preço do arroz`, `café subiu?` | Histórico e comparação determinística, com período explícito. |
| Ajuda | `ajuda`, `o que você faz?` | Exemplos curtos relevantes ao contexto atual. |

## Estados da conversa

Estados persistidos por usuário e canal. O estado contém somente a ação, campos já confirmados, origem e expiração; nunca armazena segredo ou conteúdo bruto de documento.

| Estado | Entra quando | Sai quando |
|---|---|---|
| `IDLE` | Nenhuma ação pendente | Intenção reconhecida ou ajuda. |
| `COLLECTING_FIELDS` | A intenção exige campo faltante, como valor, categoria, cartão ou data | Todos os campos válidos foram preenchidos ou usuário cancela. |
| `AWAITING_CONFIRMATION` | Existe rascunho de ação financeira completo | `confirmar` aplica uma única vez; `cancelar` descarta; alteração volta a coletar só o campo pedido. |
| `AWAITING_IMPORT_FILE` | Usuário pediu importar nota | Foto/PDF válido chega, ou usuário cancela. |
| `AWAITING_IMPORT_REVIEW` | OCR/QR terminou e gerou prévia | Usuário revisa/edita e confirma no app; WhatsApp recebe link seguro para revisão. |
| `PROCESSING` | Operação externa curta está em curso | Sucesso, erro tratável ou timeout. |
| `COMPLETED` | Ação foi gravada com sucesso | Próxima mensagem volta a `IDLE`. |
| `CANCELLED` | Usuário cancelou ou sessão expirou | Próxima mensagem volta a `IDLE`. |
| `FALLBACK` | Manual não reconheceu com confiança | IA responde somente se houver entitlement/crédito; senão ajuda contextual. |

Regras:

- `confirmar`, `sim` e `ok` só valem em `AWAITING_CONFIRMATION`; fora dele, não fazem ação.
- `cancelar`, `parar` e `voltar` descartam o rascunho atual, sem alterar dado existente.
- Sessão de coleta expira em 15 minutos sem mensagem; confirmação expira em 5 minutos. Após expirar, o bot explica que o rascunho foi descartado.
- Cada confirmação recebe uma chave idempotente: reentrega do WhatsApp ou duplo toque não pode criar duas transações.

## Carregamento e timeout

| Caso | Interface no app | WhatsApp | Regra |
|---|---|---|---|
| Consulta manual | Resultado imediato; só mostra loading após 250 ms | Uma única resposta | Meta de resposta do motor local: 1 s. |
| OCR/QR de nota | “Lendo a nota…” → “Montando sua revisão…” | Confirma recebimento da foto e envia link quando a prévia estiver pronta | Não bloquear a conversa; o rascunho pode continuar processando. |
| Fallback de IA | “Consultando seus dados…” → “Organizando a resposta…” | Responder uma vez ao terminar; indicador de digitação apenas se o gateway suportar | A IA começa ao falhar a confiança manual, não depois de cinco segundos. Aos 5 s, mostrar atraso e oferecer nova tentativa; não inventar resposta. |

O carregamento explica trabalho real. Não usar “pensando” para esconder erro ou cobrança.

## Um motor, três experiências

O núcleo é único e sem interface própria:

`App web/desktop + app mobile + WhatsApp → adaptador do canal → resolvedor de identidade → roteador com escopo → serviços financeiros existentes`

- Web e celular usam o JWT/sessão já autenticada; o backend extrai a identidade do token e ignora qualquer `userId` recebido no corpo da mensagem.
- WhatsApp recebe webhook assinado. A sessão/número vinculado resolve o dono no servidor; número, texto, estado e id de mensagem nunca podem informar ou trocar o `userId`.
- O roteador gera a mesma intenção, rascunho e confirmação para o mesmo comando, independentemente do canal.
- A diferença de UX é só esta: app mostra cartões e revisão inline; WhatsApp responde texto curto e abre link autenticado para revisões longas, como nota fiscal.

## Isolamento obrigatório entre contas

Não existe garantia honesta de “risco absoluto zero”. A meta técnica é impedir vazamento por desenho, com defesas independentes e testes de invasão entre contas A, B e C.

### Chave de escopo

No Lumen atual, a chave de isolamento é `userId`. Todo contexto de bot, rascunho, vínculo WhatsApp, leitura, escrita e chamada de IA carrega esse escopo somente no servidor. Quando o plano Compartilhado existir, a chave evolui para uma conta/grupo com checagem explícita de membro; nunca se mistura automaticamente com outra conta.

### Regras invioláveis

1. Nenhuma rota do bot aceita `userId`/`accountId` do app ou do WhatsApp como autoridade. A identidade vem exclusivamente de JWT válido ou de vínculo de WhatsApp validado no servidor.
2. Toda busca, atualização e exclusão inclui o escopo no `where`: `id + userId` para registros individuais. Um id adivinhado da conta B retorna “não encontrado” para A.
3. Estado de conversa, rascunho e confirmação possuem `userId`, canal, expiração e chave idempotente. Confirmar um rascunho de B usando sessão A falha antes de chamar qualquer serviço financeiro.
4. O WhatsApp só é ativado depois de vínculo iniciado dentro da conta autenticada e confirmado por código/QR de uso único. Um número só pode ficar ativo em uma conta; desconectar revoga sessões pendentes desse número.
5. O webhook valida assinatura, sessão vinculada e id de mensagem antes de processar. Reentrega da mesma mensagem não reaplica ação.
6. A LLM recebe somente contexto carregado para o `userId` já autenticado. Histórico, nota, memória e resultados de A jamais entram no prompt de B; fallback de IA não pode chamar ferramentas de escrita.
7. Logs, métricas e mensagens de erro não exibem saldo, texto de nota ou identificadores de outra conta.

### Testes de segurança obrigatórios

- Criar A, B e C, cada uma com saldo, cartão, meta, nota e conversa diferentes.
- Tentar ler, confirmar, editar e excluir por id de outra conta em app e WhatsApp; todos devem falhar sem revelar se o id existe.
- Tentar trocar `userId` no corpo, token, callback, link de revisão e payload de webhook.
- Mandar a mesma mensagem duas vezes, confirmar duas vezes e alternar números vinculados.
- Rodar conversas paralelas A/B/C e comprovar que estado, histórico, prompt de fallback e resposta permanecem isolados.
- Revisão de segurança obrigatória antes de habilitar escrita via WhatsApp; incluir testes de mutação para retirar filtros de escopo.

## Importação de nota sem LLM

Fluxo obrigatório:

`foto/PDF ou QR → extração OCR/QR → prévia editável → validação total/itens → normalização → confirmação → lançamento + histórico`

1. A extração preenche estabelecimento, data, itens, quantidade, preço unitário, total e chave/documento quando existir.
2. A prévia compara a soma dos itens ao total da nota e destaca diferença.
3. O usuário pode editar cada item, categoria, quantidade, preço e total.
4. O sistema detecta nota provavelmente duplicada e exige decisão explícita.
5. Só a confirmação cria a despesa e marca a nota como importada.
6. Produto normalizado, quantidade e unidade alimentam comparação de preço, gasto recorrente e insights posteriores.

O `ImportsService` atual usa SelahIA apenas na extração. A revisão, persistência e comparação existente serão preservadas; OCR/QR Code substitui essa chamada antes de desligar a LLM.

## Segurança e confiança

- Toda leitura e ação é filtrada pelo `userId` autenticado; WhatsApp precisa ser vinculado a uma única conta Lumen antes de aceitar comandos.
- O bot nunca revela dado de outro usuário, nem usa IA para contornar autorização.
- Valores aceitam formato brasileiro (`32,90`, `2 mil`) e são normalizados no servidor; ambiguidades pedem esclarecimento.
- Ações de dinheiro, cartão, metas e importação definitiva sempre exigem confirmação explícita.
- A LLM não recebe imagem bruta de nota nem executa ferramentas de escrita; recebe só contexto mínimo permitido e dados já autorizados.
- Logs de métricas guardam intenção e resultado, não texto financeiro bruto além do necessário para auditoria técnica.

## Ordem de implementação

1. Criar contrato de DTOs, estados persistidos, resposta do roteador e chave idempotente.
2. Implementar consultas financeiras e criação confirmada de despesa/receita dentro do app.
3. Adicionar cartões, limites, metas/reservas, contas fixas, recorrências e parcelados.
4. Trocar extração de nota por OCR/QR e conectar prévia/revisão ao roteador.
5. Conectar o adaptador WhatsApp ao mesmo motor, com vínculo de conta e revisão por link.
6. Implementar os testes de isolamento A/B/C e revisão de segurança antes de habilitar escrita pelo WhatsApp.
7. Implementar fallback de IA por entitlement/crédito, sem permitir escrita por IA.
8. Adicionar alteração/exclusão explícita por conversa.

## Matriz mínima de testes

- consultas retornam apenas dados do dono da conversa;
- cada formato de valor/data e campo faltante;
- `confirmar`, `cancelar`, expiração e reentrega duplicada;
- ações de cada domínio respeitam os mesmos serviços/regras da tela de Finanças;
- limite de cartão disponível, fechamento e vencimento corretos;
- nota com OCR divergente, edição, duplicata e confirmação;
- fallback bloqueado sem plano/crédito e nunca capaz de gravar;
- app e WhatsApp produzem o mesmo rascunho para a mesma mensagem.
- contas A, B e C não acessam estados, dados, rascunhos, confirmação ou contexto de IA umas das outras.
