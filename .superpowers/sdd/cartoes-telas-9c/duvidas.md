# Dúvidas de produto da 9c-1a

1. Teto e escopo do cartão padrão continuam na tela de Cartões (abaixo da lista). O comentário antigo diz que moram aqui. Mantive para não perder função. Confirmar se fica ou se sai quando o card de Finanças assumir.
2. Sem rede, a lista de cartões não tem cache: mostra erro de carregar com "Tentar de novo". Confirmar se está bom ou se deve mostrar o último cartão padrão salvo.
3. Erro 422 (teto de 10) aparece como "Você já tem 10 cartões ativos. Arquive um para criar outro." Confirmar o texto.

# Dúvidas de produto da 9c-1b

4. Abas do ciclo: o brief pedia também `PUT /credit-cards/:id/ceiling` por aba. Não implementei: o card do ciclo segue só de leitura e o teto continua editado em /card (que edita só o padrão). Confirmar se a troca de teto por cartão entra agora ou depois.
5. Edição com cartão: lançamento, parcelado e conta fixa não têm tela de edição (conta fixa só pausa/retoma e exclui). Não há "item existente" para carregar o cartão gravado. Confirmar se isso fica para a 9c-2.
6. Menu do Telegram: `/cartao` agora vira "cartao" no motor (antes ia com a barra). `/cartoes` vira "meus cartoes". Confirmar se é esse o comportamento desejado para `/cartao`.
