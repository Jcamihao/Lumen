# Brief de revisão e correção: item 3b2a

Data: 2026-11-15. Este é o roteiro futuro da revisão, não um relatório de verificações executadas.

Leia o contrato aprovado do 3b2, `brief-backend.md`, `brief-frontend.md`, `contrato-tipos.md`, `duvidas.md`, as regras globais e o diff inteiro. Revise e corrija os caminhos autorizados. Resultado em `resultado-revisao.md`, separando achados, correções, verificações e pendências. Nenhum commit, push, deploy, migration ou alteração de `.env`.

## Critérios de correção

- As quatro situações não se confundem: rollback conhecido, commit confirmado, commit desconhecido e pré-condição mudada sem escrita.
- Reserva e provisão inicial são atômicas. O recibo do bot não depende de agregação posterior. Efeito auxiliar falhando após o commit não produz restauração ou retry financeiro.
- O limite usa pré-condição conferida no núcleo do serviço, dono/ciclo corretos e bloqueio compartilhado com o método usado pela tela. Nova versão é exigida após mudança de ciclo, teto ou opção de todas as formas.
- A condição de mês da reserva mantém a política UTC existente e exige nova confirmação se o mês mostrado mudou.
- A/B não leem nem alteram recursos ou rascunhos alheios. Idempotência do item 1 permanece nos fluxos antigos e novos.
- Novos tipos não antecipam 3b2b. Cartões/restauração/avisos dependem de `rows`, sem dados financeiros persistidos no navegador.

## Mutantes obrigatórios

Cada variante é aplicada sozinha, executada contra testes adequados e desfeita antes da próxima. Registrar morte por asserção; erro de compilação não comprova cobertura. Acrescentar teste para cada sobrevivente e repetir.

1. Usar outro `userId` na criação da reserva.
2. Usar outro `userId` no teto e remover o filtro do dono no bloqueio.
3. Tirar envelope e provisão da mesma transação, permitindo salvar apenas um.
4. Restaurar o rascunho depois de recibo confirmado quando cache falha.
5. Restaurar ou liberar `appliedKey` quando o resultado do commit é desconhecido.
6. Remover a comparação do ciclo antes do upsert.
7. Remover a comparação do teto observado antes do upsert.
8. Remover a comparação de `countAllPayments`.
9. Ignorar a mudança de mês UTC da reserva.
10. Aceitar a versão antiga depois de atualizar o snapshot.
11. Remover `AWAITING_CONFIRMATION`, a reivindicação exclusiva ou `appliedKey` na confirmação nova; testar as três variantes separadas.
12. Remover checagem do plano ao abrir ou ao confirmar; testar as duas variantes.
13. Chamar agregação/leitura posterior obrigatória para devolver o recibo e transformar sua falha em erro de gravação.
14. Deslocar o destino para o ciclo recalculado depois da confirmação, sem novo aceite.

## Integração real

Usar Postgres/Redis isolados e backend/frontend reais; conferir portas e processos antes de subir. A referência de infraestrutura descartável do 3b1 está em `conferencia-principal.md` daquela entrega; os arquivos de `/tmp` podem ter sido apagados, não presumir que continuam disponíveis.

1. Duas contas sintéticas, com plano Grátis e billing habilitado somente no ambiente de teste; sem checkout.
2. Criar reserva no chat, confirmar em paralelo e conferir uma entidade, uma provisão e nenhuma transferência bancária/lançamento de despesa fictício. A segunda reserva ativa é recusada; conta B não vê nem confirma a de A.
3. Falhar a provisão inicial dentro de transação real: nenhum envelope/provisão deve sobrar; nova confirmação após rollback grava uma vez.
4. Falhar efeitos auxiliares após commit: cadastro continua confirmado; não há novo rascunho para repetir. Não inventar saldo após falha de agregação.
5. Definir limite, verificar na tela e na linha do ciclo do dono. Modificar teto pela tela entre rascunho e confirmação: mostrar novo cartão/versão e não sobrescrever antes de nova confirmação.
6. Simular relógio para mudança de ciclo, mês UTC da reserva e timezone, sem alterar o relógio do sistema ou dados de usuários reais. Validar que nenhum limite vai para o ciclo novo com o aceite antigo.
7. Falha controlada de confirmação de commit: nenhuma oferta de nova gravação da mesma versão; não desligar Postgres/Redis compartilhados. Declarar o limite de resultado desconhecido, sem prometer exatamente uma vez.
8. Chrome: reserva e limite em claro/escuro, 390/1280 px, restauração na coleta e confirmação, sem overflow, toque mínimo de 44 px, foco e Enter. Abrir e julgar as capturas.

Rodar testes e build de cada parte, regressão completa e testes de datas nos três fusos. Lint deve informar a dívida existente separadamente. Principal confere o diff, amostra dos testes, integração de segurança e `ponytail-review`, e atualiza grafo AST/handoff ao fechar. Remover contas/chaves/processos próprios e deixar apenas mudanças do escopo; relatórios não substituem a conferência do principal.
