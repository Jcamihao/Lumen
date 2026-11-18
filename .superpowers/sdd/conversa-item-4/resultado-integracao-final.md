# Resultado da integração real do item 4 (importar nota fiscal sem IA)

Branch feature/importar-nota-fiscal, HEAD c46857c. Ambiente descartável: Postgres 16 (porta 55433) e Redis 7 (porta 56380) em containers lumen-int4-*, backend `node dist/main` na porta 3390 sem nenhuma variável SELAH_*, frontend buildado servido por servidor estático com proxy de /api na porta 4390. Navegador: Chrome do Playwright dirigido por Puppeteer. Capturas e scripts ficam fora do Git, no scratchpad int4.

## Etapa 1: ambiente

Migrations aplicadas (`prisma migrate deploy`), `nest build` e `npm run build` do frontend verdes. API respondeu `/api/v1/health`. Usuário A cadastrado pela API com `aiAssistantEnabled:false` e login pelo navegador funcionando.

## Etapa 2: tela de Importações como usuário A (cenários a a f)

- (a) nota-n1.png: prévia com 10 itens, total 179,94, estabelecimento e data corretos, alta confiança. Confirmar gravou (POST commit 201, aviso "Nota fiscal registrada no financeiro"). PASSOU.
- (b) mesma nota de novo: caixa "Possível duplicata / Parece que você já lançou esta compra", botão vira "Importar mesmo assim", clique gravou (201). PASSOU.
- (c) nota-n1-jpeg.jpg: aviso "Total divergente" com soma R$ 155,63 contra total R$ 179,94, "Baixa confiança", "Leitura incerta, confira cada linha". Também mostra duplicata (mesma chave de acesso), esperado. PASSOU.
- (d) nota-n2-texto.pdf: prévia lida do PDF com texto (Farmácia Saúde Viva, 13/04/2026, total 250,94, igual ao truth.json). PASSOU.
- (e) nota-n1-digitalizada.pdf: HTTP 400 e mensagem "Este PDF é uma imagem digitalizada e não pode ser lido. Envie a foto da nota em JPG ou PNG.", sem prévia. PASSOU.
- (f) imagem em branco: HTTP 422 e mensagem "Não consegui ler esta nota. Lance o gasto pelo chat ("50 mercado") ou pela tela de Finanças.", sem prévia. PASSOU.
- 409 real via curl: preview de nota com chave já importada e commit sem `acknowledgeDuplicate` devolve 409 com `code: RECEIPT_DUPLICATE_UNCONFIRMED`; com `acknowledgeDuplicate:true` devolve 201. PASSOU.
- Sem scroll horizontal e sem elemento fora da tela em 360 px em nenhum estado.

Observações visuais (360 px): a mensagem de erro (e, f) aparece abaixo da caixa de upload, perto do fim da página; em tela baixa pode ficar fora da área visível até rolar. O placeholder do campo "Novo grupo" fica cortado ("Novo grup") em 360 px. Nada disso é regressão do item 4.

## Etapa 3: item 4c no navegador (usuário A, sem consentimento de IA)

- "importar nota": cartão "Assistente manual" com o texto "Para importar uma nota, abra Importações e envie a foto ou o PDF. A leitura é feita aqui no Lumen e você confere tudo antes de gravar." e botão "Abrir importações". O botão navega para /imports. PASSOU.
- Nenhuma chamada ao Selah: a única chamada da conversa foi `POST /api/v1/conversation/message` (200), nenhuma requisição externa saiu do navegador, o backend rodou sem variáveis SELAH_* e o log do backend não tem nenhuma linha de Selah além do mapeamento de rotas. `GET /conversation/session` voltou `{"state":"IDLE"}`: nenhum rascunho criado. PASSOU.
- "ajuda": cartão com exemplos e nenhum botão. PASSOU.
- "ler nota", "enviar nota" e "importar nota fiscal": cartão e botão "Abrir importações". PASSOU.
- "como importar nota?": nenhum cartão manual nem botão; o texto caiu no caminho do Selah e, como o usuário não deu consentimento, abriu o diálogo "Primeiro uso do Selah" sem chamar o servidor do Selah. PASSOU (comportamento esperado para texto não reconhecido pelo motor manual).
- Capturas do cartão em 1280 e 360 px, tema claro e escuro: texto sem corte, botão dentro da tela e com contraste bom nos dois temas.

## Etapa 4: isolamento entre usuários

Usuário B (sem consentimento de IA) importou a nota-n1.png depois de o usuário A já ter 3 compras importadas com a mesma chave de acesso: a prévia de B NÃO mostrou a caixa de duplicata e o botão era "Confirmar importação" (commit 201). Reenviando a mesma nota como B, aí sim a caixa de duplicata apareceu, com "Importar mesmo assim". Conferido também no banco descartável: A com 3 notas IMPORTED, B com 2, 5 transações no total. PASSOU: a duplicata é por usuário.

## Etapa 5: console e disco

- Console do navegador: apenas o aviso verbose do Chrome sobre `autocomplete` no campo de senha e os dois "Failed to load resource" dos erros esperados 400 (cenário e) e 422 (cenário f). Nenhum log da aplicação com texto da nota.
- Log do backend: nenhuma ocorrência de texto da nota (busca por FRANGO, SUPERMERCADO, BOM PRECO, CNPJ, rawText: zero linhas).
- Disco: nenhum arquivo de imagem ou PDF novo em /tmp, /var/tmp ou no diretório do backend depois dos testes (só os assets do build do frontend em frontend/dist, que são do build). O processo do backend tinha aberto apenas o arquivo de log. Observação: a tabela ReceiptScan guarda `rawText` limitado a 500 caracteres (trecho de texto da nota, não os bytes do arquivo); é o desenho atual, registrado aqui só para o dono saber.

## Etapa 6: capturas

Em scratchpad/int4 (fora do Git): a-, b-, c-, d-, e-, f-previa-d1280.png (página inteira em 1280 px), -m360-topo.png e -m360-fim.png (360 px, topo e fim), a-commit-d1280.png e b-commit-d1280.png (após gravar), 4c-cartao-claro/escuro-d1280/m360.png, 4c-ajuda e 4c-como-importar. Em 360 px não houve scroll horizontal nem elemento fora da tela em nenhum estado (medido por script). Achados visuais, todos menores e anteriores ao item 4: a mensagem de erro dos cenários (e) e (f) aparece abaixo da caixa de upload, perto do fim da página, e em celular pode exigir rolagem para ser vista; o placeholder do campo "Novo grupo" aparece cortado ("Novo grup") em 360 px; o banner "Confirme seu email" ocupa espaço no topo (mesma causa: contas de teste sem email verificado). Nas capturas de página inteira, a barra de navegação fixa do celular aparece no meio da imagem: é efeito da captura, não da tela.

## O que NÃO foi verificado

- Câmera e seletor de arquivo reais do celular (o upload foi simulado com o campo de arquivo).
- Tema escuro das telas de Importações (só o cartão do assistente foi conferido no escuro).
- Fluxo de comparação com a nota anterior marcando "Comparar com a nota anterior" (checkbox não foi marcado).
- Qualquer chamada real ao Selah (por desenho, sem variáveis SELAH_*).
- Nota com leitura por OCR em foto real (só as fixtures sintéticas).

## Limpeza

Containers lumen-int4-pg e lumen-int4-redis removidos, backend e servidor estático encerrados, nenhuma porta de teste (3390, 4390, 55433, 56380) em uso, perfis temporários do Chrome removidos. Containers antigos do desenvolvedor e o banco de desenvolvimento não foram tocados. Nenhum arquivo do código foi alterado: nenhum bug encontrado que exigisse correção.
