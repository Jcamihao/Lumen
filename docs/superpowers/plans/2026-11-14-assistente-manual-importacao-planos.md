# Lumen — lançamento viável sem LLM

Data: 2026-11-14  
Status: proposta consolidada com as decisões confirmadas pelo dono; ainda não altera código, preço ou cobrança. Franquias e preços continuam pendentes.

## Objetivo

Lançar o Lumen sem custo recorrente de Gemini, GPT ou outro modelo generativo. O assistente inicial será determinístico: executa comandos conhecidos, consulta os dados reais do usuário e conduz fluxos curtos no aplicativo e no WhatsApp. A IA generativa fica desligada, preservada apenas como melhoria futura paga.

O posicionamento não é “uma IA que conversa sobre tudo”. É “controle financeiro rápido, confiável e baseado nos seus dados”.

## Decisões de produto

1. A LLM fica em modo `OFF`: nenhuma chamada a provedor externo, nenhum crédito de IA necessário para o lançamento.
2. O código do provedor não será apagado. Uma configuração única escolhe entre `OFF` e `FALLBACK` futuro.
3. Aplicativo e WhatsApp usam o mesmo motor determinístico; muda apenas o canal de entrada e saída.
4. O motor nunca inventa dados nem executa lançamento, edição ou exclusão sem confirmação explícita.
5. Em `OFF`, mensagem não reconhecida mostra ajuda curta e exemplos. Em `FALLBACK`, o roteador chama automaticamente a IA se o plano tiver crédito, a ação for segura e o motor manual não reconhecer uma intenção confiável. A entrada continua registrada como métrica agregada para decidir o próximo comando a criar.
6. A integração WhatsApp começa em sessão/instância WA-AKG isolada do Hora H. Ela é apropriada para beta, mas não deve prometer SLA comercial enquanto continuar não oficial.
7. A experiência não precisa expor a troca de motor a cada mensagem. No app, enquanto a resposta demora, a interface mostra estados neutros como “Consultando seus dados…” e “Organizando a resposta…”. O uso de IA, créditos restantes e política de dados ficam claros no plano/configurações, não escondidos.

## O que o assistente manual faz

Primeiro conjunto de comandos e fluxos:

- Lançar gasto: `50 mercado`, com confirmação de valor, categoria e data antes de salvar.
- Consultar saldo, resumo do mês, gastos por categoria e próximos vencimentos.
- Mostrar metas, reservas, contas fixas e parcelados existentes.
- Consultar compras importadas: total, itens recorrentes, preço e variação entre meses.
- Guiar o usuário por opções quando faltarem dados ou houver ambiguidade.
- Mostrar ajuda e encaminhar para suporte quando não houver fluxo seguro.

O assistente pode aceitar texto curto natural, mas não tenta interpretar conversa aberta. Cada intenção tem parser, validação e resposta em template.

## Importação de nota fiscal sem LLM

Importação e chatbot são componentes diferentes. A importação não depende de chat generativo:

`foto/PDF → OCR ou QR Code → itens estruturados → revisão do usuário → banco → comparações por regra`

O fluxo obrigatório antes de persistir:

1. Extrair estabelecimento, data, itens, quantidades, preços e total.
2. Exibir um rascunho editável.
3. Conferir soma dos itens contra o total informado; avisar diferença, nunca esconder erro.
4. Normalizar produto recorrente e unidade quando houver confiança; permitir correção humana.
5. Detectar possível nota duplicada antes de criar lançamentos.

As comparações iniciais são determinísticas:

- gasto total de mercado neste mês versus média dos dois anteriores;
- categorias que mais cresceram ou caíram;
- produtos recorrentes mais comprados;
- variação de preço do mesmo produto;
- preço por unidade/quilo quando a unidade estiver disponível.

Uma LLM futura pode explicar esses resultados em linguagem mais livre. Ela não é necessária para calcular os números.

**Auditoria em 14/11/2026:** `ImportsService.previewReceiptImport()` chama `parseReceiptWithSelah()` e exige `SELAH_ASSISTANT_ENABLED`; portanto, hoje a leitura de nota para quando a LLM é desligada. A revisão manual, a persistência dos itens e a comparação de preços já existem. A Fase 2 deve trocar apenas a extração por OCR/QR Code e parser estruturado. OCR pode ter custo próprio ou rodar localmente; isso é separado do custo de LLM e deve entrar na franquia do plano.

## Catálogo inicial de comandos (v0)

São 15 comandos de lançamento, concentrados em dinheiro e importações. Leitura nunca pede confirmação; ação que grava dado mostra resumo e exige `confirmar` ou `cancelar`. Edição e exclusão ficam fora da primeira versão de chat.

| # | Intenção | Exemplos aceitos | Resposta/fluxo |
|---|---|---|---|
| 1 | Saldo | `saldo`, `quanto tenho?` | Saldo atual e resumo curto do mês. |
| 2 | Resumo mensal | `resumo`, `resumo do mês` | Entradas, saídas, saldo e alerta principal. |
| 3 | Gastos totais | `quanto gastei?`, `gastos do mês` | Total de saídas do período atual. |
| 4 | Gastos por categoria | `gastos com mercado`, `quanto gastei com transporte?` | Total e participação da categoria no mês. |
| 5 | Próximos vencimentos | `o que vence?`, `vencimentos` | Contas fixas e parcelas próximas. |
| 6 | Parcelas | `minhas parcelas`, `cartão` | Parcelas abertas e próximo impacto. |
| 7 | Contas fixas | `contas fixas`, `despesas fixas` | Lista curta e total mensal. |
| 8 | Metas | `minhas metas`, `como está minha reserva?` | Progresso, valor restante e próxima ação segura. |
| 9 | Compras importadas | `últimas compras`, `minhas notas` | Últimas notas confirmadas e seus totais. |
| 10 | Preço de item | `preço do arroz`, `quanto paguei no café?` | Histórico e menor preço conhecido do item normalizado. |
| 11 | Comparar item | `arroz subiu?`, `compare café` | Variação contra histórico e período usado. |
| 12 | Importar nota | `importar nota`, envio de foto no canal suportado | Abre envio; depois sempre encaminha para revisão, nunca grava direto. |
| 13 | Lançar gasto | `50 mercado`, `gastei 32,90 em farmácia` | Extrai valor/categoria/data, mostra rascunho e pede confirmação. |
| 14 | Lançar entrada | `recebi 800 freelance`, `entrada de 200` | Mostra rascunho de entrada e pede confirmação. |
| 15 | Ajuda | `ajuda`, `o que você faz?` | Mostra exemplos curtos por grupo, sem menu longo. |

Regras do roteador:

- **Alta confiança:** formato completo e valor/data válidos. Responde ou abre confirmação.
- **Média confiança:** há intenção, mas falta categoria, valor ou período. Faz uma única pergunta objetiva.
- **Baixa confiança:** no plano Inteligente chama fallback de IA; nos demais mostra ajuda contextual.
- **Nunca:** efetuar lançamento, alteração, exclusão ou importação definitiva por inferência da IA.
- **WhatsApp:** o mesmo catálogo; envio de imagem é tratado como pedido de importação e só cria rascunho.

## Planos propostos

O catálogo atual é `Grátis / Individual / Compartilhado`. Esta proposta só entra quando o dono aprovar a revisão do billing; até lá, nada muda no catálogo, nas telas ou no Asaas.

| Plano | Valor entregue | Limites propostos |
|---|---|---|
| Grátis | Organização financeira base | Sem assistente, sem WhatsApp e sem importação de nota por imagem. Mantém dados, exportação e segurança sem bloqueio. |
| Controle | Assistente manual no app e no WhatsApp | Uma conta WhatsApp por usuário; comandos, consultas e fluxos guiados. Sem LLM. |
| Pro | Tudo do Controle + importações | Franquia mensal de notas/imagens a definir; revisão, histórico e comparações determinísticas. |
| Inteligente (futuro) | Tudo do Pro + IA como fallback automático | Franquia mensal de créditos de IA; comandos determinísticos sempre rodam antes da IA. |

Para o lançamento, vender apenas **Grátis, Controle e Pro**. “Inteligente” começa como adicional de créditos, não como IA ilimitada. Só vira plano próprio depois que custo, uso e conversão forem medidos.

O plano atual `INDIVIDUAL` pode ser migrado para “Controle” ou servir de base para ele. `PRO` exige novo `PlanId`, novos entitlements e migração de preços/landing. O futuro `SHARED` continua independente dessa decisão.

## Regras de preço e segurança de margem

- Não incluir LLM ilimitada em nenhum plano.
- Medir mensagens, notas processadas, falhas de OCR, comandos não entendidos e custo por usuário antes de fixar franquias.
- Cobrar excedente de IA por créditos. Importações também podem ter excedente, se o OCR tiver custo variável.
- O WhatsApp não é vendido como garantia de disponibilidade enquanto depender de WA-AKG; comunicar que é integração em beta até existir canal oficial ou operação equivalente.
- O usuário precisa poder interromper mensagens, remover a conexão e encontrar suporte humano facilmente.

## Ordem de execução

### Fase 0 — diagnóstico e contrato

1. Auditar o `AssistantService`, `buildLocalReply`, `enrichReply`, `detectIntent` e a importação atual. **Feito:** a leitura atual de nota depende do SelahIA; o catálogo v0 está nesta página.
2. Escrever contrato de comandos, estados, confirmações, erros e eventos de métricas.
3. Criar a chave que desliga a LLM sem apagar o código.
4. Decidir franquia inicial de notas e se o Grátis terá alguma amostra de importação.
5. Contrato detalhado de Finanças por conversa: `docs/superpowers/specs/2026-11-14-assistente-manual-financas.md`.

### Fase 1 — assistente manual no aplicativo

1. Extrair o motor determinístico para serviço independente de canal.
2. Implementar os comandos iniciais e respostas em template.
3. Registrar intenção reconhecida, conclusão, cancelamento e entrada não reconhecida sem gravar texto sensível desnecessário.
4. Testar confirmação, autorização e isolamento de usuário.

### Fase 2 — importação confiável e insights

1. Separar extração, revisão, normalização e persistência.
2. Garantir conferência de total, edição e deduplicação.
3. Criar os cinco insights determinísticos iniciais.
4. Permitir que o assistente consulte esses insights dentro do app.

### Fase 3 — WhatsApp manual

1. Subir WA-AKG isolado, webhook assinado e sessão separada.
2. Criar adaptador WhatsApp para o mesmo motor da Fase 1.
3. Implementar consentimento, comando de parada, ajuda e escalonamento humano.
4. Validar envio, recebimento, duplicidade de webhook e reconexão com número de teste.

### Fase 4 — billing e lançamento

1. Revisar o catálogo, `EntitlementsService`, landing, textos legais e checkout para Grátis/Controle/Pro.
2. Aplicar limites de WhatsApp, importação e IA por entitlement, nunca espalhados pelos módulos.
3. Convidar poucos usuários para validar os comandos mais usados antes de ligar cobrança geral.

### Fase 5 — IA opcional

1. Ligar `FALLBACK` apenas para o plano/adicional com créditos.
2. O motor manual tenta primeiro; quando não reconhecer uma intenção confiável, a LLM é chamada automaticamente, sem exigir que o usuário escolha o modo.
3. O fallback começa imediatamente; cinco segundos não decidem se a IA será usada. Esse tempo é apenas um limite de experiência: se a resposta atrasar, mostrar um estado de carregamento neutro e depois oferecer nova tentativa ou ajuda, sem prender a conversa.
4. Nunca permitir ação financeira automática a partir de resposta da LLM; exigir confirmação e regras locais.

## Critérios de lançamento

- LLM desligada e nenhuma chamada externa de IA em produção.
- Pelo menos os comandos iniciais funcionam no app com confirmação e testes.
- Nota importada pode ser revisada, corrigida e salva; totais inconsistentes aparecem ao usuário.
- Comparações usam dados persistidos e explicam o período comparado.
- Bot do WhatsApp usa o mesmo motor e não mistura dados entre usuários.
- O plano pago libera apenas o que o `EntitlementsService` autoriza.

## Decisões que ainda dependem do dono

1. Quais comandos entram entre os primeiros 15.
2. Quantas notas/imagens mensais entram no Pro e se haverá pacote extra.
3. Preços de Controle e Pro; não definir antes de medir o custo de OCR e suporte.
4. Se o Grátis terá uma demonstração limitada de importação ou nenhuma.
5. Quando a integração WhatsApp sai de beta e qual canal oficial/sustentável substituirá WA-AKG no crescimento.

