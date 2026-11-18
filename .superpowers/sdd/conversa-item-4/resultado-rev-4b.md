# Resultado da revisão 4b (tela de nota sem IA)

Status: concluída. Etapas 0 a 5 abaixo; integração real feita antes do reinício da máquina e não repetida depois.

## Etapa 0: linha de base (verificado)

- Branch `feature/importar-nota-fiscal`, commit revisado `28e323b`.
- `tsc --noEmit -p tsconfig.app.json`: sem erros.
- `ng test --watch=false --browsers=ChromeHeadless`: 286 de 286.

## Achados da leitura do diff (antes de corrigir)

1. Médio: `localTotalMismatch` só calcula se `preview.totalMismatch` veio do servidor. Quem cria divergência ao editar não vê aviso.
2. Médio: o campo de arquivo não é limpo; depois de um erro de leitura, escolher a mesma foto de novo não dispara `change`.
3. Médio: o bloco "Resumo da compra" só aparece com `purchaseSummary`, `spendingSignals` ou `followUpActions`. O backend novo manda os três vazios, então a quebra por categoria (determinística) nunca aparece.
4. Baixo: `extraction.warnings` aparece duas vezes (lista de avisos e chips de `notes`, que o backend preenche com os mesmos textos).
5. Baixo: textos sem acento no fluxo de nota ("Nao foi possivel registrar a compra no financeiro.", "Nao foi possivel criar o grupo.").
6. Baixo: erro do commit mostra mensagens diferentes na tela (`receiptError`) e no toast.
7. Médio: caso 409 com a página rolada para baixo: a caixa abre no topo e o usuário pode não vê-la antes do segundo clique.

## Etapa 1: correções (commit feito, ver `git log`)

Corrigidos os achados 1 a 7 acima:
- `localTotalMismatch` agora sempre calcula (soma local dos itens contra o total local), em centavos; 1 centavo de diferença não avisa, 2 avisam. Prévia sem divergência + edição cria o aviso.
- `input.value = ''` logo depois de ler o arquivo (também quando falta o grupo).
- `hasPurchaseSummary` inclui `categoryBreakdown`; "Resumo da compra" aparece só com a quebra por categoria.
- `receiptNotes` tira dos chips o que já está em `extraction.warnings`.
- `revealDuplicateBox()` rola a caixa para a tela (preview com `possibleDuplicate` e 409).
- Erro de commit: mesma mensagem em `receiptError` e toast; textos com acento.
- Ponto 1 do agente principal: decidido que não é preciso passo extra além do que existe. Com `possibleDuplicate` na prévia, o único botão de confirmar já tem o rótulo "Importar mesmo assim" e a caixa está no topo da prévia; com 409, o primeiro clique ("Confirmar importação") não leva `acknowledgeDuplicate`, o segundo (após a caixa abrir e rolar para a tela) leva. Testes cobrem os dois caminhos.
- Dúvida 6 do dev (confirmar com a caixa visível envia `acknowledgeDuplicate: true`): aceita, é o que o contrato descreve ("só depois dessa ação").

Testes do spec da tela: 36 de 36.

## Etapa 2: mutantes (verificado, spec da tela, desfeitos com `git checkout` do próprio arquivo; `git status` limpo depois de cada um)

Todos mortos (nenhum vivo):
- (a) `acknowledgeDuplicate` sempre true: 2 testes falham.
- (b) nunca enviado: 2 falham.
- (c) 409 não abre a caixa: 4 falham.
- (d) aviso de divergência sempre escondido: 6 falham.
- (e) aviso nunca some: 6 falham.
- (f) `confidence === 'low'` sem texto: 1 falha.
- (g) `extraction.warnings` não listados: 2 falham.
- (h) erro do preview não limpa a prévia: 3 falham.
- (i) portão de IA de volta (upload escondido sem consentimento): 35 falham.
- (j) botão "Importar mesmo assim" com a caixa fechada: 10 falham.
- (k) soma e total invertidos no aviso: 3 falham.
- (l) nota antiga sem `extraction` quebra a renderização: 1 falha.
- Extras para as correções: sem limpar `input.value` (2 falham); `hasPurchaseSummary` sem `categoryBreakdown` (1 falha).

## Etapa 3: integração real (verificado)

Ambiente: Postgres 16 (`lumen-rev4b-pg`, porta 55433), Redis 7 (`lumen-rev4b-redis`, 56380), `prisma migrate deploy` ok, `nest build`, `node dist/main` com `SELAH_*` vazios, frontend buildado servido por um servidor estático na porta 4300, navegador Chrome via Puppeteer (já é devDependency do projeto). Usuário cadastrado com `aiAssistantEnabled: false`.

Resultados no navegador (viewport desktop):
- Upload visível e funcional sem consentimento de IA. Passou.
- `nota-n1.png`: prévia com 10 itens, total 179,94, alta confiança, sem aviso. Confirmar gravou (toast "Nota fiscal registrada no financeiro."). Passou.
- `nota-n1.png` de novo: caixa "Parece que você já lançou esta compra" com a descrição do lançamento, botão "Importar mesmo assim"; clicar gravou (201). Passou.
- `nota-n1-jpeg.jpg`: aviso "A soma dos itens (R$ 155,63) é diferente do total da nota (R$ 179,94)", confiança baixa, "Leitura incerta, confira cada linha.", e a lista de avisos. Passou. Observação: o aviso do servidor ("A soma dos itens é diferente do total da nota. Confira cada linha.") fica logo abaixo do aviso local com os valores; é repetição leve, mantida porque o texto do servidor cobre outros casos.
- `nota-n1-digitalizada.pdf`: HTTP 400, "Este PDF é uma imagem digitalizada e não pode ser lido. Envie a foto da nota em JPG ou PNG." mostrada na tela, sem prévia. Passou.
- Imagem em branco: HTTP 422, "Não consegui ler esta nota. Lance o gasto pelo chat ("50 mercado") ou pela tela de Finanças." Passou.
- Console do navegador: só as linhas nativas "Failed to load resource" dos 400 e 422; nenhum log da aplicação.

Achados novos na integração, corrigidos:
- Quantidade de peso aparecia como "Qtd. 1.331" (em pt-BR parece mil trezentos e trinta e um); agora "1,331" via pipe `number`.
- Rótulo "Sem sugestao" do backend aparecia sem acento; a tela mostra "Sem sugestão" (backend não pode ser alterado).
- 360 px: "Alimentacao" quebrava no meio da palavra ao lado da etiqueta de itens; a linha agora quebra e a etiqueta desce (`flex-wrap` só na prévia).

Limites: o 409 real só ocorre em corrida (o preview já marca `possibleDuplicate` quando a chave repete), então foi coberto por teste de unidade e por `curl` (ver etapa 4 se feito).

Nota sobre a integração real: ela foi feita ANTES de a máquina reiniciar (Docker, `node dist/main` e as capturas daquela rodada foram perdidos no reinício). Depois do reinício o `docker` não existe mais neste WSL, então a integração não foi refeita; os resultados acima são da rodada anterior, não repetidos. Não verificado de novo depois do último commit de CSS (só mudança de estilo e de formato de texto, coberta pelo spec). O 409 real do backend foi conferido por `curl` na rodada anterior: corpo `{"statusCode":409,...,"code":"RECEIPT_DUPLICATE_UNCONFIRMED","message":"Parece que você já lançou esta compra. Confirme para importar mesmo assim."}`, o mesmo formato que o spec usa.

## Etapa 4: capturas visuais com API simulada (verificado)

Navegador: Chromium 1255 do cache do Playwright, dirigido por Puppeteer (já é devDependency), contra o build do frontend (`npm run build`, hash `c03fd38ef5cc2bf2`) servido por servidor estático local. API simulada por interceptação de rota com respostas sintéticas (prévia normal, divergência, duplicata, leitura incerta com 3 avisos, 422). Arquivos em `/tmp/claude-1001/-home-caminhao-coding/bd9c9413-cf71-4265-8b29-e861b90c2685/scratchpad/rev4b/`, nome `<estado>-<largura>-<tema>-<topo|fim>.png` (5 estados, 1280 e 360 px, claro e escuro, topo da prévia e fim da página).

O que vi:
- Prévia normal: leitura limpa nos dois temas, "Resumo da compra" com a quebra por categoria, quantidades com vírgula ("1,331"), "Sem sugestão" com acento.
- Divergência: caixa com etiqueta "Total divergente" e o texto com os dois valores, antes do botão; legível nos dois temas e em 360 px.
- Duplicata: caixa com etiqueta, título, descrição do lançamento parecido e "Confirme só se for outra compra." Problema achado e corrigido: em 360 px etiqueta e título ficavam na mesma linha; corrigido no commit de CSS (título em linha própria). Botão "Importar mesmo assim" no fim da lista, visível acima da barra inferior quando a página chega ao fim.
- Leitura incerta: "Leitura incerta, confira cada linha." mais a lista dos 3 avisos em caixa própria; sem corte e com contraste bom.
- 422: mensagem do servidor em vermelho abaixo do botão de envio; legível claro e escuro; em 360 px aparece inteira no fim da página.
- Nenhum overflow horizontal em nenhuma combinação (o script checa `scrollWidth` contra `clientWidth`).
- Barra inferior fixa em 360 px cobre o que está no fim da rolagem enquanto o usuário rola (comportamento do app, não mudou); no fim da página o botão de confirmar não fica coberto.
- Console do navegador: nenhuma linha da aplicação (só erros de rede esperados da simulação).
- Observações fora do escopo: data em formato americano e total com ponto são do locale do Chrome headless (en-US), não do app; placeholder "Novo grupo" cortado em 360 px (tela de grupos já existente).

## Etapa 5: números finais (verificado, depois do reinício)

- `npx tsc --noEmit -p tsconfig.app.json`: sem erros (exit 0).
- `npx ng test --watch=false --browsers=ChromeHeadlessCI`: 310 de 310 (antes 286; +24 testes, todos do spec da tela). Necessário `PUPPETEER_EXECUTABLE_PATH` apontando para o Chromium do Playwright, porque o cache do puppeteer foi apagado no reinício e o `karma.conf.js` usa `puppeteer.executablePath()`.
- `npm run build`: ok, hash `c03fd38ef5cc2bf2`.

## Segurança e texto (verificado)

- Sem `innerHTML`, `bypassSecurityTrust` ou `console.*` no componente; teste confirma que HTML dentro de `merchantName`/`notes` vira texto. Nada em `localStorage` (teste espia `setItem`).
- Nenhum "Selah"/"IA" sobrando no fluxo de nota (grep em `features/imports` fora do spec: nada). "Nao"/"possivel" sem acento no fluxo: corrigidos; sobrou só "Sem sugestao" vindo do backend, tratado na tela.
- `role="alert"` só nas duas caixas de decisão (divergência e duplicata), como no resto do app (feedback e QR usam em erro/aviso); lista de avisos e "Leitura incerta" ficam sem role, são texto estático.

## Não verificado

- Integração real depois do reinício (sem Docker).
- 409 real do navegador contra o backend (só unitário e `curl`).
- Dispositivo real e Safari/iOS.
