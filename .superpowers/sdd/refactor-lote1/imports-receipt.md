# Revisão: refatoração imports/receipt (lote 1)

Data: 2026-11-26. Conferido por: Claude Sonnet 5.5 (revisão independente). Sem commit.

## Fidelidade ao original
- Limites, mensagens, ordem das passadas, pontuação (4/2/2/-0,1), prazos (QR 800 ms, OCR 30 s, prazo único entre as duas passadas) e limpeza do worker/pool: idênticos ao HEAD (comparado linha a linha).
- ocrBudgetMs: agora lido ao entrar em extractReceiptFromImage, antes de guarda/rotação/QR. O prazo (Date.now() + budget) continua calculado depois do QR. Só mudaria algo se alguém alterasse ocrBudgetMs no meio de uma extração (só testes, e só antes de chamar extract). Sem impacto de comportamento. Aceito.
- HEIC agora lança dentro de readReceipt (async), logo vira rejeição e o finally decrementa activeReads como antes.
- Guarda de imagem: ordem (abrir, dimensão <=0, megapixels) igual.
- Ordem de wake/terminate/creating no OcrPool igual (worker.factory termina no erro de setParameters; spawn faz wake e creating--).
- DI: imports.module e receipt-import.service resolvem pelas portas (receipt-extractor.service.ts, receipt-readers.ts). Specs antigos passam sem mudança.

## Tamanho e estilo
- Todos os arquivos <=120 linhas (maior: ocr-pool.ts, 114). Funções <=20, exceto extractReceiptFromImage (~22 linhas de corpo). Menor, sem correção.
- Detalhe cosmético: comentário do ocr-pool perdeu o acento ("portugues").

## ReDoS (receipt-text.parser.spec.ts)
- 15 execuções seguidas isoladas do spec inteiro: 15/15 verdes (199 testes). Casos ReDoS rodam em 1 a 9 ms.
- Parser não foi alterado nesta refatoração. A falha única de 2043 ms vs 500 ms foi flake por contenção de CPU (load average 10 a 16 na máquina, outros agentes rodando jest/tsc). Limite de 500 ms mede parede, não CPU. Recomendação: não mexer na refatoração; se incomodar, subir o limite para 1500 ms ou usar process.cpuUsage.

## Suíte
- npx tsc --noEmit | grep '^src/imports': vazio.
- npx jest src/imports em TZ=UTC, America/Sao_Paulo, Asia/Tokyo: 9 suítes, 272 testes verdes nos três (antes dos novos testes: 5 suítes, 253).

## Mutantes (59 injetados, cada um revertido; git diff e árvore idênticos ao início)
Primeira rodada: 26 mortos, 33 sobreviventes (os mesmos sobreviveriam no original: lacunas de teste, não defeitos da refatoração).
Após 4 specs novos: 57 mortos, 2 equivalentes.

Mortos já pelos testes existentes: image-guard >→>= e >→<, limite do cabeçalho, OCR_BUDGET 30s→3s, MAX_CONCURRENT 2→3, busy >=→>, passScore >→>=, needs2nd ||→&& e !==→===, 2ª sempre escolhida, secondPass=false, sem mensagem de timeout, confiança /10, sem rotate, HEIC removido, PDF/imagem trocados, activeReads-- perdido, total nulo aceito, PDF curto aceito, erro de leitura PDF, método PDF, pool sem discard, discard sem delete, PDF sem destroy doc/task, 3→2 páginas, sem hasEOL, join de páginas, erro engolido, qr >=→>.

Mortos pelos testes novos:
- PDF_MIN 40→41 e 40→39: extraction-rules.spec.ts (39 vs 40 caracteres).
- QR_DEADLINE 800→1: extraction-rules.spec.ts.
- passScore (pesos total/itens/divergência e sinal dos avisos): extraction-rules.spec.ts.
- runOcr <=0→<0: extraction-rules.spec.ts (Date.now fixo, prazo = 0).
- 2ª passada sem preparo e resize 1400→1000: extraction-rules.spec.ts (largura 1400).
- prazo novo por passada: extraction-rules.spec.ts (30000 e 20000 ms).
- toPng sem mensagem: extraction-rules.spec.ts (PNG truncado).
- buildExtraction com alias de warnings: extraction-rules.spec.ts.
- pool sem deadline.clear, sem release no prazo vencido, passed nunca true, max workers 2→3, spawn sem wake, creating-- perdido: receipt-readers/ocr/ocr-pool.spec.ts.
- factory sem terminate, cache, PSM 6→3: receipt-readers/ocr/ocr-worker.factory.spec.ts.
- qr sem 600, ordem das larguras, catch lança, sem attemptBoth, sem flatten branco: receipt-readers/qr/qr-decoder.spec.ts.

Equivalentes (2):
- image-guard "width <= 0 || height <= 0" -> "< 0": sharp não reporta dimensão 0 para imagem decodificável; com metadata ausente a conversão seguinte falha com a mesma mensagem OPEN_IMAGE_MESSAGE. Inalcançável com efeito distinto.
- image-conversion sem limitInputPixels no toPng: a guarda ensureReadableImage já recusa o mesmo limite (25 Mpx) antes; defesa em profundidade redundante.

Contagem exata: 59 = 57 mortos + 2 equivalentes; 0 sobreviventes.

## Defeitos reais
Nenhum encontrado na refatoração.

## Testes novos (cada um <=120 linhas)
- receipt-extraction/extraction-rules.spec.ts (101)
- receipt-readers/ocr/ocr-pool.spec.ts (81)
- receipt-readers/ocr/ocr-worker.factory.spec.ts (33)
- receipt-readers/qr/qr-decoder.spec.ts (48)

## NÃO verificado
- OCR real sob carga (testes reais já existentes passaram, mas a máquina estava saturada por outros agentes).
- Fallback PDF para imagem: não existe no original nem no novo (PDF digitalizado devolve erro); mutante não aplicável.
- Integração com banco/contêiner: fora do escopo (refatoração de leitura local, sem I/O externo).
- Suíte completa do backend (apenas src/imports, por regra de não tocar auth/assistant).
- graphify update não rodado (sem commit pedido).
