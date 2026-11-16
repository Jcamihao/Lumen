# Decisões técnicas e dúvidas: item 3b2a

Data: 2026-11-15. Planejamento concluído; backend parcialmente iniciado e interrompido a pedido do dono para handoff. Sem validação por testes/build novos, frontend ou revisão.

## Decisões registradas no brief

- Aprovação do dono: contrato do 3b2 validado em 2026-11-15. Não pedir novamente aprovação de duas entregas, política de vencimento ou campos adiados.
- O domínio compartilha o núcleo de gravação entre o método atual da tela e o método que devolve um recibo mínimo ao bot. Não fazer escrita financeira pelo roteador e não depender de enriquecimento posterior para confirmar uma gravação.
- Envelope e provisão inicial ficam na mesma transação. O mês UTC exibido fica congelado no rascunho em `provisionMonth`; mudança exige novo aceite. É um detalhe técnico da política existente, não criação de uma data configurável.
- Limite usa bloqueio da linha do dono, snapshot e relógio capturado dentro do núcleo de gravação. Pré-condição mudada devolve nova confirmação, sem upsert.
- Commit desconhecido não é rollback conhecido. Manter a chave da versão, encerrar o rascunho e orientar conferência na tela. Sem recuperação automática nem promessa de exatamente uma vez nesse cenário.
- A quota mantém a tolerância concorrente já documentada no serviço de entitlements; não está sendo vendida como limite serializável.

## Dúvidas pendentes

Nenhuma decisão de produto pendente para iniciar o 3b2a. Se o desenvolvimento exigir schema, nova idempotência persistida, mudança de preço, alteração de outro módulo ou mudança no contrato aprovado, registrar aqui a evidência e comunicar ao principal antes de ampliar o escopo.

## Evidências

Alguns métodos e tipos dos briefs já foram escritos, mas não integrados/validados. O checkpoint exato de arquivos está em `docs/HANDOFF.md`, seção 6. As últimas evidências executadas pertencem ao 3b1: backend 963, frontend 248 e integração documentada na pasta daquela entrega. Não apresentar esses números como testes do 3b2a.

Na implementação iniciada, o agente principal apontou que o frontend esconde o texto completo de `CONFIRM_DRAFT` e usa `rows`; por isso a razão de mês/snapshot alterado deve estar também nas linhas, incluindo após restauração. Os drafts parciais já têm `reviewReason?`. Conferir e documentar o formato final no contrato de tipos ao concluir o motor.

## Backend 3b2a, implementação (2026-11-15, subagente de desenvolvimento)

### Decisões onde o brief era omisso

1. **Nome que começa com número durante a coleta.** Com o rascunho de reserva esperando o nome, texto que começa com dígito vira nome (ex.: `2026 viagem`, `50 mercado`). Texto sem dígito inicial segue a regra de comando: comando explícito (ex.: `gastei 50`, `criar meta`) responde com o aviso de rascunho em andamento, sem substituir.
2. **Corpo da reserva.** Valor no início consome só o primeiro token de valor (`3 mil viagem`). Nome de 1 caractere vira "pergunta de nome", não erro (mesma regra das metas). Nome de 61 caracteres recusa.
3. **Duplicidade de nome na abertura.** Checada na abertura com `prisma.envelope.findFirst({ where: { userId, name } })` (nome exato, como a unicidade do banco). Leitura, não gravação, então não passa pelo serviço. Na confirmação, a mesma regra vem do P2002 do serviço.
4. **Limite com texto que não é valor** (`definir limite nubank`): recusa com `creditLimitValueOnly`, não pergunta o valor. Assim o banco nunca é ignorado em silêncio.
5. **Texto de confirmação do limite.** O contrato não fixou o texto do corpo. Usei `Limite de R$ X para o ciclo com fechamento em DD/MM/AAAA.` e o `DONE` do contrato, igual ao da seção 4.
6. **Texto do aviso de atualização pendente.** O contrato (seção 3) traz "Cadastro salvo. A atualização dos lançamentos está pendente; confira a tela de Finanças.". Para reserva e limite, "lançamentos" não se aplica, então usei "dados": `Cadastro salvo. A atualização dos dados está pendente; confira a tela de Finanças.`. Dono pode querer o texto exato; trocar em `REPLIES.refreshPending`.
7. **Revisão e linha "Atenção".** O motivo da revisão vai no prefixo do `text` e numa linha `Atenção` em `rows`, que persiste na sessão (fica no rascunho) e aparece em `GET /conversation/session`. Não há campo visual novo.
8. **Pré-condição do limite lida na abertura** com `CreditCycleService.getCurrent`: ciclo, `ceiling` (teto vigente do ciclo, não o `previousCeiling`) e `countAllPayments`.
9. **Revisão sem espaço.** Se, durante a revisão, outro rascunho ocupou a sessão do canal, não sobrescreve: responde `revisionRestoreLost` ("O pedido mudou e outro rascunho já foi aberto. Envie o pedido de novo.").
10. **`DraftKind` do tipo de evento.** Eventos das novas intenções usam `intent` = `create_envelope` / `set_credit_limit`. Sem texto de mensagem.

### Mudanças de comportamento no caminho HTTP (precisam de aceite do principal)

A. **`EnvelopesService.create` (tela):** agora valida no domínio nome de 2 a 60 caracteres (após aparar) e valor de 0,01 a 9.999.999.999 com até 2 casas. O DTO já cobria quase tudo, mas o nome `"  a  "` antes era aceito e agora recebe 400. A forma da resposta não mudou (teste de chaves).
B. **`EnvelopesService.create` (tela):** a provisão inicial deixou de passar por `ensureTopUps` e vai direto na transação (mesmo mês). Equivalente quando `createdAt` e `now` caem no mesmo mês, que é o caso de criação agora. Falha de provisão agora reverte o envelope (antes ficava um envelope sem depósito).
C. **`CreditCycleService.setCeiling` (tela):** falha ao atualizar dados derivados (`touchUserData`) deixou de virar 500 depois da gravação. Agora grava, loga só o nome do erro e responde 200 com o estado. Motivo: o contrato exige que falha pós-gravação não reporte erro como se nada tivesse sido feito. Se o dono preferir o comportamento antigo na tela, é uma linha.
D. **`CreditCycleService.setCeiling` (tela):** agora grava dentro de transação com `SELECT ... FOR UPDATE` no `User` (o bloqueio que o brief pede). Falha de validação de valor vira `BadRequestException` antes da transação.

### Achados no código parcial (antes desta sessão)

- `envelope.parser.ts`: erro de tipo (`reason` acessado depois de `if (parsed.ok)`). Corrigido com `=== true`.
- `intent.matcher.spec.ts`: dois casos antigos (`criar reserva viagem`, `nova reserva`) afirmavam "não casa", em desacordo com o contrato 3b2 aprovado. Atualizei para casar, mantendo `criar conta fixa` como não casa (é do 3b2b). Não é bug de código, é expectativa desatualizada.
- Specs de `envelopes.service` e `credit-cycle.service` não mockavam `$transaction` (10 falhas). Adicionei mock de transação em memória que chama o callback com o mesmo cliente fake.
- Não achei bug de regra de gravação no código parcial de envelope/limite (transação, bloqueio, classificação de commit desconhecido, mês UTC, pré-condição). Os três mutantes de domínio e o do motor foram mortos pelos testes (ver relatório).

### Dúvidas para o dono ou principal (pare aqui antes de ampliar escopo)

- **Texto do aviso de atualização pendente** (item 6): "dados" ou "lançamentos"?
- **Aceite das mudanças HTTP A a D.** Se não aceitar, D precisa de rollback e teste de regressão do comportamento antigo.
- **Integração real pendente.** Nada foi rodado contra Postgres. Os testes são com mocks. O revisor precisa cobrir: provisão falha de verdade, FOR UPDATE de verdade, commit desconhecido de verdade.
- **Lint.** O backend não tem configuração de ESLint (o script `lint` aponta para arquivo inexistente). Não há comparação de lint possível.

### Limites conhecidos (não resolvidos neste recorte)

- Abrir rascunho de limite chama `creditCycle.getCurrent` antes de gravar o rascunho. Se essa leitura falhar, o erro sobe para a API (500) sem evento. Nada foi gravado, então é seguro, mas não é o tratamento de `runRead`.
- Commit desconhecido: sem recuperação automática. A chave da versão fica registrada, então a mesma versão não grava de novo. Se o usuário enviar o pedido de novo, nasce outro rascunho (intencional, conforme o contrato).
- Janela já documentada (queda entre reivindicar e aplicar) continua existindo.
