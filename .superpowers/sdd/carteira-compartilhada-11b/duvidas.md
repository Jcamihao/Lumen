# Duvidas de produto da 11b-1a (decisoes tomadas por padrao; o dono confirma ou corrige)

1. **Resposta do escopo padrao.** Para `scope=mine` (padrao) a resposta ficou igual a de hoje: sem `isShared`, `isMine` nem `sharedByName`. Esses campos so aparecem em `shared` e `all`. Se o front quiser os campos sempre, e uma troca pequena.
2. **Parceiro nao muda tipo, forma de pagamento, cartao, envelope nem vinculos** (tarefa, meta) do lancamento do autor: 403 `PARTNER_EDIT_RESTRICTED`. O contrato so fala em editar; escolhi o minimo.
3. **Desmarcar compartilhamento nao exige grupo ativo.** So marcar exige (409). Motivo: "sempre revogavel" (contrato, secao 1).
4. **Parceiro ve `updatedAt` e nao ve `userId`, `categoryId` nem `cardName`** nos lancamentos do autor. Categoria de lancamento do autor aparece so como nome e cor. Categoria da lista do parceiro traz `icon`, mas nao `monthlyBudget`.
5. **Parceiro que nao ve o item: 404** (mesma resposta do inexistente). Parceiro que ve o item e tenta apagar a categoria do autor: 403.
6. **Categoria apagada pelo autor** tira a categoria tambem dos lancamentos dos parceiros (categoryId vira nulo). Nao apaga lancamento nenhum.
7. **Categoria compartilhada que o autor deixa de compartilhar** continua aparecendo como nome e cor nos lancamentos compartilhados que a usam (regra 5 do contrato). Confirmar se e isso mesmo ou se o lancamento deve voltar sem categoria.
8. **Exportacao de categoria** traz `shared` por item e nao traz a marca interna; o orcamento continua na exportacao do proprio dono.
