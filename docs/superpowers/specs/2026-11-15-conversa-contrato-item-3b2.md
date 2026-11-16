# Finanças por conversa: contrato do item 3b2

Data: 2026-11-15.
Status: validado explicitamente pelo dono em 2026-11-15, com a resposta "validado". Briefs técnicos do 3b2a preparados em `.superpowers/sdd/conversa-item-3b2a/`; backend parcialmente escrito e interrompido a pedido do dono para handoff, sem testes/build novos executados. Frontend e revisão ainda não iniciados. O 3b1 está revisado e commitado em `d1d2fa2` (backend), `45604a1` (frontend) e `2cf5fb2` (documentação).

Fonte da ordem: `2026-11-14-assistente-manual-financas.md`, item 3. Este documento detalha o recorte que falta: criar reservas/envelopes, definir limite do cartão único, cadastrar contas fixas e compras parceladas. Não autoriza push, deploy, mudanças de preço nem migração de dados existentes.

## 1. Entregas e decisões aprovadas

| Entrega | Conteúdo | Dependência |
|---|---|---|
| 3b2a | Criar reserva e definir limite do cartão atual | Corrigir o resultado de gravação dos dois serviços antes de habilitar as novas intenções |
| 3b2b | Criar conta fixa e compra parcelada | Revisão do 3b2a fechada e correção do resultado de gravação dos serviços de recorrências/parcelados |

Cada entrega tem desenvolvimento, revisão de segurança, testes reais e atualização do handoff próprios. Um subagente por vez, conforme a regra global do dono. Os modelos solicitados devem ser usados quando disponíveis; indisponibilidade deve ser explicitada, nunca registrada como execução por outro modelo.

Decisões aprovadas pelo dono ao validar este contrato:

1. O bot usa os serviços e o catálogo de planos existentes. Não cria tabelas, migrations, rotas ou DTOs HTTP novos. Não grava entidades financeiras diretamente pelo roteador.
2. Nenhuma das quatro ações ocorre sem rascunho completo e confirmação explícita. Coleta dura 15 minutos; confirmação, 5. Permanecem versão, cancelamento, isolamento e `appliedKey` dos itens anteriores.
3. Na primeira versão, contas fixas criadas pelo bot são despesas; frequências mensal, semanal e anual são aceitas, com mensal como padrão visível. Receitas recorrentes, data final e edição ficam para um recorte posterior.
4. A primeira data de vencimento de conta fixa/parcelado é obrigatória. O bot aceita somente hoje ou futuro, até o máximo de dois anos permitido pelo serviço. Datas passadas são recusadas com orientação para cadastrar o histórico pela tela. Não se escolhe hoje silenciosamente, nem se gera histórico retroativo por conversa neste recorte.
5. Categoria e forma de pagamento ficam não informadas nesta versão, como os serviços já permitem. O rascunho mostra isso. Não se presume cartão de crédito por ser parcelado. Quem precisar dessas opções usa a tela; interpretar categorias/pagamento na frase fica fora desta entrega.
6. Mantém-se o teto atual do parser do bot: R$ 1.000.000,00 por valor, embora os DTOs das telas aceitem valores maiores. Zero, negativo ou separador ambíguo são recusados. Não se remove limite de cartão com zero.
7. A criação da reserva faz a provisão mensal do envelope existente; não cria uma transferência bancária ou um aporte em meta. O aviso precisa distinguir esses efeitos.

## 2. O que foi verificado no código

| Domínio | Serviço existente e campos | Efeito atual |
|---|---|---|
| Reserva | `EnvelopesService.create(userId, { name, color, monthlyAmount })` | Cria envelope ativo, gera provisão do mês, atualiza dados derivados e agrega saldo |
| Cartão | `CreditCycleService.setCeiling(userId, { ceiling })` | Faz upsert do teto do ciclo atual, atualiza dados derivados e relê o ciclo |
| Conta fixa | `RecurringTransactionsService.create(userId, { type, description, amount, frequency, firstDueDate })` | Cria regra, materializa vencimentos já devidos do usuário e atualiza dados derivados |
| Parcelado | `InstallmentsService.create(userId, { description, totalAmount, installmentsTotal, firstDueDate })` | Cria compra, materializa parcelas já devidas do usuário e atualiza dados derivados |

Fontes lidas: serviços e DTOs de `envelopes/`, `credit-cycle/`, `recurring-transactions/` e `installments/`; os dois materializadores; parsers atuais de valor/data; catálogo de planos; formulário de reservas no frontend.

Os métodos de criação hoje têm operações posteriores à persistência que podem lançar erro. Os materializadores têm transações por ocorrência, mas a criação da regra/compra não faz parte dessas transações. Este documento não considera esses riscos já corrigidos.

## 3. Segurança da gravação: pré-requisito de cada entrega

Repetir o problema corrigido no 3b1 é proibido: se o registro já foi criado, uma falha posterior não pode restaurar o mesmo pedido como se nada tivesse sido gravado.

Contrato para a implementação:

- A persistência principal e a preparação de uma resposta de confirmação baseada nos campos persistidos formam o núcleo do serviço. O roteador recebe o id e os campos desse resultado para responder, sem depender de uma segunda agregação bem-sucedida.
- Provisão/materialização e atualização de dados derivados são etapas posteriores explicitamente tratadas. Falha posterior à persistência retorna sucesso de cadastro com aviso de atualização pendente, registra `resultRef` e não restaura o rascunho. Não se informa saldo disponível ou número de lançamentos como zero quando a leitura falhou; omite-se esse dado e mostra-se o aviso.
- Para envelope, quando necessária, a criação da entidade e da provisão inicial deve ser atômica. Falha antes de completar esse núcleo reverte ambos e permite restaurar o rascunho. As provisões continuam usando a unicidade existente por envelope/mês.
- Materialização de contas/parcelados preserva as transações, limites e unicidade existentes. Cadastro persistido com materialização incompleta não pode virar uma segunda regra/compra por retry. O aviso é: "Cadastro salvo. A atualização dos lançamentos está pendente; confira a tela de Finanças." As próximas leituras usam os mecanismos de materialização já existentes.
- Uma refatoração mínima dos serviços pode separar resultado persistido de enriquecimento para o bot, compartilhando a mesma validação e gravação usadas pela tela. Não duplicar regra em `ConversationService`; não introduzir framework genérico de comandos, outbox, novo schema ou dependência nesta entrega. A forma exata dessa separação deve constar no brief de implementação antes de delegar.
- Falha comprovadamente anterior à persistência segue D5: limite do plano/4xx descarta o rascunho; erro inesperado restaura. Estado de commit desconhecido, por exemplo perda da conexão durante commit, não é tratado como falha comprovada: não se oferece repetição automática; exige conferência na tela e registra-se a limitação. Não prometer recuperação exatamente uma vez desse cenário sem um contrato adicional de idempotência transacional.
- A janela já documentada de queda entre reivindicar o rascunho e aplicar a ação continua existindo. Não é corrigida por este recorte.

Alterações nos serviços de domínio descritas aqui são parte do escopo aprovado do 3b2. Outros métodos de edição/saque e serviços fora da lista não são incluídos automaticamente. O detalhamento técnico do 3b2a está em `.superpowers/sdd/conversa-item-3b2a/`; ele não significa que os métodos ali descritos já existem.

## 4. Gramática e campos pendentes

Comandos novos exigem prefixo explícito, sem `?` e com até 20 palavras, dentro do limite global de 500 caracteres. Essa regra só vale para as quatro intenções novas; o limite do matcher de metas/aportes não muda. Leituras como `cartão`, `limite do cartão`, `reservas` e `contas fixas` continuam sendo leituras. Perguntas e recomendações não viram escrita.

| Intenção | Prefixos | Exemplo completo |
|---|---|---|
| `create_envelope` | `criar reserva`, `nova reserva`, `criar envelope` | `criar reserva 400 gasolina` |
| `set_credit_limit` | `definir limite`, `definir limite do cartão` | `definir limite do cartão 5 mil` |
| `create_recurring` | `criar conta fixa`, `nova conta fixa` | `criar conta fixa 120 internet mensal primeiro 20/11/2026` |
| `create_installment` | `criar parcelado`, `novo parcelado` | `criar parcelado 1200 geladeira em 12x primeiro 20/11/2026` |

No limite do cartão, testar o prefixo mais longo antes do mais curto. Prefixo isolado inicia a coleta. Frase longa ou interrogativa segue a regra de não reconhecimento/fallback existente; texto com formato inválido depois de um prefixo aceito pede correção, sem descartar tokens desconhecidos silenciosamente.

Gramática dos corpos:

- Reserva: valor no início seguido de nome; somente nome pergunta valor. Corpo vazio pergunta nome, depois valor. Valor depois do nome não é inferido nesta versão, evitando interpretar um número do nome como dinheiro. Nome tem 2 a 60 caracteres e mantém números.
- Cartão: somente um valor completo; sem valor pergunta. Não aceita nome de banco/cartão, datas ou regras de fechamento no corpo.
- Conta fixa: `[valor inicial] <descrição> [mensal|semanal|anual] [primeiro <data>]`. A frequência e a data, quando presentes, são sufixos delimitados; não se remove uma palavra coincidente no meio da descrição. Frequência ausente vira mensal e aparece no cartão. Corpo sem valor pergunta depois da descrição; sem data pergunta no final. Descrição tem 2 a 120 caracteres.
- Parcelado: `[total inicial] <descrição> [em <N>x] [primeiro <data>]`. O valor informado é sempre o total da compra, nunca o valor de cada parcela. Somente total inicial ou resposta à pergunta de total são aceitos; `12x de 100` não é interpretado como total de R$ 100. Sem contagem pergunta; sem data pergunta. Descrição tem 2 a 120 caracteres.

Para cada comando, quando há valor no início, ele pode ocupar os tokens já suportados (`3 mil`, `R$ 50`, `1,5k`). Em respostas a um campo de valor, o valor deve consumir toda a resposta; texto restante pede reenvio. Não interpretar nome, data ou quantidade como valor financeiro por engano.

Datas aceitas neste recorte: `hoje`, `dd/mm` e `dd/mm/aaaa`, usando o fuso do dono e validação de calendário do parser existente. `dd/mm` usa o ano atual, sem avançar silenciosamente para o próximo ano. `dia 5`, `amanhã`, ISO, duas datas ou expressões não suportadas pedem uma data completa. A data resolvida fica congelada no rascunho; na confirmação revalidam-se hoje/máximo de dois anos. Se ficou passada durante a coleta, pedir novo vencimento e aumentar a versão antes de confirmar.

Ordem de coleta: nome/descrição → valor → quantidade de parcelas, se houver → primeiro vencimento, se houver. Antes do parser de novos comandos, o estado pendente decide se um número é valor, quantidade ou opção. O preenchimento de nome/descrição deve aceitar texto começando com número; um comando explícito diferente continua pedindo cancelar o rascunho anterior, sem substituição silenciosa.

Perguntas propostas:

| Campo | Pergunta |
|---|---|
| Nome de reserva | "Qual o nome da reserva? Ex.: gasolina." |
| Valor mensal de reserva | "Quanto reservar por mês? Responda só o valor." |
| Limite | "Qual o limite para este ciclo do cartão?" |
| Descrição | "Qual a descrição? Ex.: internet ou geladeira." |
| Conta fixa | "Qual o valor de cada vencimento?" |
| Total parcelado | "Qual o valor total da compra, antes de dividir em parcelas?" |
| Quantidade | "Em quantas parcelas? Responda um número de 2 a 60." |
| Primeiro vencimento | "Qual o primeiro vencimento? Responda hoje ou uma data, como 20/11/2026." |

## 5. Rascunhos e respostas

Adicionar à união existente de `DraftKind`: `ENVELOPE`, `CREDIT_LIMIT`, `RECURRING`, `INSTALLMENT`, somente quando a entrega correspondente for implementada. Dados persistidos previstos:

```ts
interface EnvelopeDraft {
  kind: 'ENVELOPE';
  name: string | null;
  monthlyCents: number | null;
  color: string;
  provisionMonth: string; // 'AAAA-MM-01' UTC exibido; mudança exige nova confirmação
  pendingField: 'name' | 'amount' | null;
}
interface CreditLimitDraft {
  kind: 'CREDIT_LIMIT';
  ceilingCents: number | null;
  cycleStart: string; // data-só UTC do ciclo retornado pelo serviço
  cycleEnd: string;
  previousCeilingCents: number | null; // teto vigente deste ciclo; não a sugestão do ciclo anterior
  countAllPayments: boolean;
  pendingField: 'amount' | null;
}
interface RecurringDraft {
  kind: 'RECURRING';
  description: string | null;
  amountCents: number | null;
  frequency: 'MONTHLY' | 'WEEKLY' | 'YEARLY';
  firstDueDate: string | null;
  pendingField: 'description' | 'amount' | 'firstDueDate' | null;
}
interface InstallmentDraft {
  kind: 'INSTALLMENT';
  description: string | null;
  totalCents: number | null;
  installmentsTotal: number | null;
  firstDueDate: string | null;
  pendingField: 'description' | 'amount' | 'installmentsTotal' | 'firstDueDate' | null;
}
```

`DraftView` continua usando `kind`, `title` e `rows`; campos legados de lançamento ficam nulos, como no 3b1. Não expor ids de categoria ou chaves internas no cartão. Adicionar os rótulos de campo `name`, `installmentsTotal` e `firstDueDate` ao frontend. Os ids dos recursos criados entram somente em `DONE.data` e no evento de confirmação.

### Reserva

Título `Reserva`; linhas Nome, Valor mensal, Início (mês atual UTC, seguindo o serviço existente), Aviso. Aviso: "A reserva recebe a provisão mensal do app. Isso não transfere dinheiro de uma conta bancária nem faz aporte em meta."

Ativa, sem ícone e com a primeira cor já usada pelo formulário (`#f18f01`); seleção de cor fora do bot. Conferir duplicidade do nome para o mesmo dono e respeitar a mensagem de conflito do domínio (inclusive em corrida). A unicidade vigente é por `userId + name`, sem prometer normalização que o banco não possui. Reutilizar o núcleo de `EnvelopesService.create`, valor em reais; nunca `GoalsService.create`. O brief detalha `createForConversation`, que compartilha esse núcleo e devolve recibo mínimo, sem agregação posterior obrigatória.

`DONE`: "Reserva criada: gasolina, R$ 400,00 por mês." `data.envelopeId`; `resultRef` recebe esse id. Não informar saldo se a agregação posterior não estiver disponível.

### Limite do cartão

Título `Limite do cartão`; linhas Ciclo (início e fim), Limite atual (ou "não definido"), Novo limite, Aviso. Sempre avisar: "Este limite vale só para o ciclo mostrado." Se `countAllPayments` estiver ligado, acrescentar: "Este ciclo considera todas as formas de pagamento."

Ler `CreditCycleService.getCurrent(userId)` para o rascunho. Antes de aplicar, revalidar ciclo, teto vigente e opção `countAllPayments`. Se mudaram desde a exibição, atualizar o cartão, aumentar a versão e exigir nova confirmação; não sobrescrever em silêncio uma alteração feita na tela.

O serviço precisa aceitar uma pré-condição interna de ciclo/valor observado, sem mudar o DTO HTTP público, e conferi-la no núcleo da escrita. Só comparar no roteador e depois chamar um método que recalcula o ciclo não fecha a corrida na virada do ciclo. Nunca gravar o limite no novo ciclo com confirmação do antigo. Não alterar fechamento, vencimento ou `countAllPayments` neste comando.

`DONE`: "Limite de R$ 5.000,00 definido para o ciclo com fechamento em DD/MM/AAAA." `data.card` usa a leitura autorizada quando disponível. `resultRef` usa o id da linha de teto realmente persistida, obtido no serviço; não confundir com id de cartão, pois esse modelo não existe no v0.

### Conta fixa

Título `Conta fixa`; linhas Descrição, Valor por vencimento, Frequência, Primeiro vencimento, Categoria ("não informada"), Forma de pagamento ("não informada") e Aviso. Para vencimento hoje: "Ao confirmar, será gerado o lançamento de hoje." Para futuro: "Os lançamentos serão gerados nos vencimentos." O serviço pode também atualizar outros cadastros já devidos do próprio usuário, como faz a tela; isso não significa que esses lançamentos pertencem ao novo cadastro.

Chamar `RecurringTransactionsService.create` com `type: 'EXPENSE'`, descrição, valor em reais, frequência e data-só. Omitir categoria, pagamento e data final. A conta nasce ativa. O calendário reutiliza `nextOccurrence`; mensal no dia 31 passa pelo último dia de meses curtos e volta à âncora 31, como a tela.

`DONE`: "Conta fixa criada: internet, R$ 120,00, mensal, primeiro vencimento em DD/MM/AAAA." Em geração de hoje, só afirmar que o lançamento foi gerado quando isso foi verificado; em falha pós-cadastro usar o aviso da seção 3. `data.recurringTransactionId`; `resultRef` recebe o id.

### Compra parcelada

Título `Compra parcelada`; linhas Descrição, Total da compra, Quantidade, Valor por parcela, Última parcela, Primeiro vencimento, Categoria e Forma de pagamento. Mostrar aviso de geração imediata para primeiro vencimento hoje.

Quantidade inteira entre 2 e 60. A divisão segue o serviço: valor comum arredondado e última parcela absorvendo a diferença. Rejeitar combinações que tornem qualquer parcela menor que um centavo, inclusive última parcela zero/negativa. Exemplo de regressão: R$ 1,00 em 60 vezes pode produzir parcelas comuns de R$ 0,02 e última negativa pelo algoritmo vigente; não permitir essa combinação. A validação deve ficar também no serviço compartilhado para que a tela não contorne a regra.

Chamar `InstallmentsService.create` com total em reais, quantidade e primeiro vencimento; omitir categoria/pagamento. Datas mensais usam a âncora existente; não criar despesa à vista adicional. `DONE`: "Compra parcelada criada: geladeira, total R$ 1.200,00 em 12 parcelas, primeira em DD/MM/AAAA." `data.installmentPurchaseId`; `resultRef` recebe o id.

## 6. Planos, erros e isolamento

Checar `EntitlementsService.assertCanCreate` ao abrir os rascunhos de envelope, conta fixa e parcelado; manter a verificação do serviço ao confirmar. Recursos: `envelopes`, `recurringTransactions`, `installmentPurchases`. Limites atuais do Grátis com billing habilitado: 1, 3 e 2, respectivamente. Não hardcode esses números no motor. Definir limite do cartão não consome vaga de plano.

`userId` vem exclusivamente do motor autenticado. DTOs e mensagens não fornecem dono nem chave interna. Rascunhos, datas, categorias eventualmente reintroduzidas e chaves do ciclo pertencem à conta autenticada. Confirmar/cancelar rascunho alheio mantém 404 equivalente ao inexistente. Não aceitar canal WhatsApp antes do vínculo/revisão próprios.

Mensagens de falha são específicas por tipo. `PlanLimitException` usa o texto permitido do domínio; duplicidade de reserva usa mensagem conhecida. Outros 4xx descartam com orientação segura e sem divulgar entidade alheia. Logs guardam intenção/operação e nome do erro, não frase, valor ou descrição. Falhas pós-persistência seguem a seção 3, não o ramo genérico de restauração.

## 7. Verificação exigida antes de fechar cada entrega

1. Matcher: exemplos completos e incompletos, frases interrogativas e naturais não sequestradas, leituras preservadas, limites de tokens e de 500 caracteres. Regressão de metas/aportes/transações anteriores.
2. Valores e coleta: todos os formatos existentes, ambíguos, zero/negativo, texto extra, nomes com números, nome vazio/limites, quantidade 1/2/60/61/fracionária e divisão que produziria parcela zero/negativa.
3. Datas em UTC/São Paulo/Tóquio: hoje, primeiro dia do mês, 31/02 inválido, ano omitido sem salto de ano, data passada recusada, teto de dois anos e rascunho atravessando meia-noite.
4. Plano: recusar ao abrir e ao confirmar se a vaga acabou; usar billing habilitado somente na instância isolada do teste, sem checkout. Garantir que falha posterior a um cadastro persistido não seja confundida com limite ocorrido na nova tentativa.
5. Confirmação: texto/botão em paralelo, versão antiga, confirmação repetida, `messageId` repetido, cancelamento e 15/5 minutos. Uma entidade por rascunho; uma provisão por mês; uma ocorrência por regra/data; uma parcela por compra/número.
6. Isolamento A/B: leituras e gravações, ids de rascunho, teto do ciclo e categoria de outro dono. Mutantes obrigatórios de `userId`, estado/versão/`appliedKey`, limite de plano e restauração indevida pós-persistência. Cada mutante sobrevivente exige teste novo.
7. Cartão: alteração concorrente pela tela, virada de ciclo entre rascunho/confirmação, nenhuma escrita no novo ciclo sem nova confirmação. Mutante removendo a pré-condição deve falhar.
8. Falhas controladas em Postgres real: falhar provisão inicial, materialização, atualização de dados derivados e enriquecimento de resposta. Verificar registros existentes antes/depois e tentar nova confirmação para provar que não duplica. Não desligar Postgres/Redis compartilhados para esse teste.
9. Integração real API + Chrome: criar cada recurso, cancelar, recarregar na coleta e confirmação, validar na tela de Finanças/cartão e com outro usuário. Cartões em claro/escuro, 390/1280 px, sem overflow, toque de 44 px, foco e Enter. Abrir e julgar capturas, não apenas produzi-las.
10. Testes/build/lint das partes alteradas e suíte completa nos três fusos; comparar lint com a dívida existente. Limpar usuários/chaves/processos próprios; atualizar grafo AST, relatórios e handoff. Commit, push e deploy só mediante pedido explícito.

O brief deve enumerar mutantes e critérios de sucesso por ação, não apenas repetir esta lista. Os testes verificam as regras compartilhadas pelas telas após as correções dos serviços, além do roteador.

## 8. Arquivos e divisão de responsabilidade

3b2a backend: `backend/src/conversation/` (motor, tipos, matcher, parser/replies e specs), `backend/src/envelopes/envelopes.service.ts` e spec, `backend/src/credit-cycle/credit-cycle.service.ts` e spec. O ajuste do ciclo pode exigir utilitário privado já em `credit-cycle/`, com caminhos explícitos no brief.

3b2b backend: os mesmos arquivos de conversa e os serviços/specs de `recurring-transactions/` e `installments/`; materializadores somente se necessário para preservar transações e relatar corretamente a persistência. Não alterar o calendário global para acomodar o bot.

Frontend em ambas: `core/models/conversation.models.ts` e `features/assistant/assistant-page/assistant-page.component.{ts,html,scss,spec.ts}`; preferir reutilizar `rows`, alterando apenas tipos, rótulos e testes necessários. Serviços HTTP de outros domínios e telas de Finanças não mudam sem motivo concreto do contrato.

Antes de cada implementação, escrever brief backend e contrato de tipos em `.superpowers/sdd/conversa-item-3b2a/` ou `conversa-item-3b2b/`, delimitando os caminhos. Front usa o contrato do backend; revisor recebe o diff inteiro e verifica a integração real. Uma alteração que exija migration, idempotência persistida adicional ou mudança de produto fora das decisões propostas deve voltar ao dono com evidência concreta.

## 9. Decisões validadas e limites de autorização

O dono validou o recorte em duas entregas, com vencimento explícito somente hoje/futuro, frequência mensal como padrão visível, e categoria/pagamento configurados pela tela nesta primeira versão. Não perguntar novamente essas escolhas antes de implementar os briefs correspondentes. A validação permite o trabalho local descrito no contrato; commit, push e deploy continuam dependendo de pedido explícito.

Receitas recorrentes, preenchimento de categoria/pagamento pelo bot, retroativos, vários cartões, alteração/exclusão, OCR/QR, WhatsApp e mudanças comerciais ficam fora deste contrato. A aprovação não significa que esses itens foram implementados ou que produção pode ser ativada.
