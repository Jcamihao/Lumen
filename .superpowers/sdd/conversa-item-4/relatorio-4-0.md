# Relatório da fase 4.0: medição de leitura de nota fiscal sem IA

Data: 2026-11-16. Autor: agente principal. Contrato: `docs/superpowers/specs/2026-11-16-conversa-contrato-item-4.md` (seção 5). Branch: `feature/importar-nota-fiscal`.

## Limite que vale para tudo abaixo

**Todas as notas medidas são sintéticas** (geradas por `spike/gen.js` e `spike/gen2.js`, com CNPJ e chave de acesso fictícios de dígito verificador válido). O texto é tipografia limpa em fonte monoespaçada. Cupom térmico real fotografado é mais difícil: papel amassado, brilho, tinta que apaga, fundo irregular, foto em perspectiva e textos que variam por emissor e por estado. O dono não respondeu a D1 (notas reais), então **nenhum número abaixo pode ser prometido a usuário**. Eles provam que a técnica funciona no caso favorável e mostram onde ela quebra primeiro, mas não medem a precisão real do produto.

Nenhuma dependência foi adicionada ao projeto. Tudo rodou num diretório descartável fora do repositório (Node 20.20, a mesma major do `Dockerfile`, com `npm install --ignore-scripts`).

## O que foi medido

8 notas sintéticas × 12 variações de imagem = 96 imagens, mais 8 PDFs com texto. As variações: limpa, limpa em 480 px, rotação de 3 e de 8 graus, desfoque leve (1,4) e forte (2,4), baixo contraste, JPEG de qualidade 35, ruído forte, tinta apagada em faixas, foto pequena (380 px, JPEG 28) e foto girada 5 graus com sombra.

Leitores avaliados: `jsqr` 1.4.0 para o QR; `tesseract.js` 7.0.0 com o dado de português `@tesseract.js-data/por` 1.0.0 para o OCR; `sharp` 0.35.5 para decodificar e pré-processar imagem; `pdfjs-dist` para o texto do PDF.

## Resultados

**QR Code (`jsqr`):** achou a chave certa em **91 de 96** imagens. Falha só em ruído forte (3 de 8 acharam), e nesse caso demorou 3,5 s por imagem (nas demais, de 35 a 90 ms). Precisa de limite de tentativas.

**OCR de imagem, sem pré-processamento ("raw"):**
- Total da nota correto em **93 de 96**. Os 3 erros (2 em desfoque forte, 1 em foto pequena) foram todos **sinalizados** pela conferência da soma dos itens. **Erros silenciosos (total errado sem aviso): 0 de 96.**
- Data correta em 94 de 96 e CNPJ lido por OCR direto em 73 de 96 (cai muito em foto girada, 0 de 8 a 8 graus). **O CNPJ derivado da chave (do QR, ou da chave do OCR quando o dígito verificador fecha) acertou 93 de 96**, inclusive em foto girada a 8 graus (8 de 8). A chave também traz mês e ano de emissão e o número da nota.
- Itens (descrição e valor corretos): 62 de 62 em imagem limpa, 47 de 62 com desfoque, 6 de 62 com desfoque forte, 30 de 62 com ruído, 47 de 62 em foto pequena. **Os itens são a parte frágil**; o total é robusto.
- Chave de acesso lida pelo OCR: só **58 de 96** corretas; o QR é a fonte confiável. Confusão típica vista: letra "O" no lugar do zero ("O9"). Só a troca de confusões (O→0, I e l→1, S→5, B→8) seguida do dígito verificador módulo 11 recupera a chave certa; sem o dígito verificador esses erros passariam como certos.
- Tempo: de 0,9 a 1,5 s por imagem (um worker, máquina de desenvolvimento). Memória do processo: cerca de 245 MB com 1 worker e 2 workers em paralelo (8 notas em 4,4 a 6,3 s).

**Pré-processamento (cinza, normalizar, redimensionar para 1400 px, nitidez) piorou:** total certo em 84 de 96 contra 93 de 96 sem ele; ruído foi de 8 de 8 para 0 de 8. Conclusão: **não pré-processar por padrão.** Pode ser tentado como segunda passada quando a primeira falhar a conferência (soma dos itens, dígito verificador).

**PDF com camada de texto:** total certo em 8 de 8, chave 8 de 8, todos os valores dos itens presentes, cerca de 16 ms por arquivo.

**Sem rede:** com o processo isolado de qualquer rede (`unshare -rn`, sem rota nenhuma), a leitura funciona igual. O dado de português fica no pacote local (`langPath`) e o núcleo WASM do OCR vem do `node_modules`, então não há download em tempo de execução.

**Recusa de arquivo ruim:** `sharp` com `limitInputPixels: 25e6` recusou uma imagem de 36 megapixels ("Input image exceeds pixel limit") e um buffer que não é imagem.

## Fatos que o contrato presumia, agora verificados

- **`sharp` instala com `npm ci --ignore-scripts`** (o binário vem como pacote opcional `@img/sharp-linux-x64` e não precisa de script). Verificado em glibc (Node 20, Debian/Ubuntu); a imagem do backend é `node:20-bookworm-slim`, mesma família. Não testei o build Docker em si.
- **HEIC (foto de iPhone) não é lido:** o `sharp` pré-compilado só decodifica `.avif` na família HEIF. HEIC deve ser recusado com mensagem clara ("envie a foto em JPG ou PNG"). Em iOS, o seletor de arquivo costuma converter para JPEG sozinho, mas isso é presumido.
- **`pdfjs-dist` 6.5.438 NÃO roda no Node 20** (exige Node >=22.13). A 4.10.38 (exige >=20) funcionou com o build `legacy`. É grande (37 MB no `node_modules`).
- **PDF sem camada de texto (digitalizado) não é lido por esse caminho.** Rasterizar PDF exigiria mais uma biblioteca nativa. Proposta: recusar com "envie a foto da nota ou um PDF com texto".

## Peso das dependências (instalado, não minificado)

`tesseract.js-core` 44 MB (vários núcleos WASM), `pdfjs-dist` 4.10.38 37 MB, `@img/sharp-libvips-linux-x64` 18 MB, `@tesseract.js-data/por` 7,8 MB, `tesseract.js` 1,7 MB, `sharp` 1,1 MB, `jsqr` 0,4 MB. Total aproximado **110 MB a mais na imagem do backend**. A imagem final também carregaria o libvips (LGPL-3.0-or-later, ligado dinamicamente pelo `sharp`): é um ponto de licença a anotar, não impeditivo.

Licenças declaradas nos pacotes: `tesseract.js` Apache-2.0, `tesseract.js-core` Apache-2.0, `jsqr` Apache-2.0, `sharp` Apache-2.0, `pdfjs-dist` Apache-2.0, `@tesseract.js-data/por` MIT (o dado treinado vem do projeto Tesseract, que é Apache-2.0; **presumido**, não conferi o arquivo de licença do dado).

## Veredito frente ao critério do contrato

Critério proposto: total correto em ao menos 80% das notas e nenhum caso em que a soma dos itens não bate e a tela não avisa. Em amostra sintética: **96,9% e 0 casos silenciosos, critério cumprido.** Como a amostra é favorável e sintética, a recomendação é **seguir para a 4a com um portão extra no fim**: antes do merge, o dono fotografa 10 a 20 notas reais pela tela de importação (ambiente de teste) e vê se o total sai certo ou o aviso aparece; abaixo de 80% de total certo, ou qualquer erro sem aviso, a 4a não faz merge e o desenho muda (QR e PDF apenas, e foto só com digitação assistida).

## Ajustes propostos ao contrato (dependem do dono)

1. **Fonte de verdade em camadas:** chave pelo QR > chave pelo OCR (só com dígito verificador válido) > texto livre. CNPJ, mês/ano e número da nota vêm da chave quando ela é válida; o OCR do CNPJ só preenche se não houver chave.
2. **Sem pré-processamento por padrão;** segunda passada com pré-processamento só quando a primeira falha a conferência.
3. **Limite de tempo do QR** (por exemplo 800 ms no total) e do OCR (30 s, como no contrato), porque o QR em imagem ruidosa leva mais de 3 s.
4. **Confusões de OCR em campo numérico** (O→0, I e l→1, S→5, B→8) corrigidas antes de validar chave e CNPJ.
5. **Biblioteca de PDF:** `pdfjs-dist` na linha 4.x (legacy), não na 6.x, enquanto o backend rodar em Node 20.
6. **HEIC e PDF digitalizado:** recusa com mensagem clara (seção 7 do contrato ganha esses dois erros 400).
7. **Peso:** +110 MB na imagem do backend, a aceitar.
8. **D4 (bibliotecas):** `tesseract.js` 7.0.0, `@tesseract.js-data/por` 1.0.0, `jsqr` 1.4.0, `sharp` 0.35.5, `pdfjs-dist` 4.10.38; versões fixas, sem faixa `^`. Aguarda aprovação do dono.

## Arquivos

Scripts descartáveis em `.superpowers/sdd/conversa-item-4/spike/` (gerador de notas sintéticas `gen.js`/`gen2.js`, avaliador `eval.js` com um parser-protótipo, `pdf.js`, `offline.js`). Rodam num diretório com as dependências acima instaladas, não dentro do projeto. As imagens geradas e `results.json` não foram guardados (reproduzíveis com os scripts).
