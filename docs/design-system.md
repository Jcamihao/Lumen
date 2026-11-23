# Design System LUMEN

> Este documento descreve o sistema **como ele existe no código**. A fonte da verdade é
> `frontend/src/styles.scss`: tokens em `:root`, tema escuro em `html[data-theme='dark']`
> e a família de classes globais `proto-*`. Se o código e este texto divergirem, o código manda.

## Direcao visual

O app roda hoje em duas peles que dividem a mesma estrutura de tokens:

- **Tema claro — "Meridian Revenue Intelligence"**: clinico, institucional, **zero-radius sem excecao**
  (todos os tokens `--radius-*` valem `0`, incluido o pill). Um unico acento cobalto (`--accent: #006cd2`)
  sobre fundo quase-branco quente (`--background: #fcf8f8`).
- **Tema escuro — "Obsidian Precision"** (`html[data-theme='dark']`, alternado pelo `ThemeService`):
  base zinco (`#09090b`), acento azul mais vivo (`#2563eb`), sombras desligadas. O bloco escuro redefine
  so os tokens; um recurso bem escrito nao precisa de regra `[data-theme]` propria.

Tipografia: **Inter** nos dois papéis (`--font-body` e `--font-display`), carregada junto com
**Material Symbols Rounded** via Google Fonts no `index.html`. Icones sao sempre a fonte de
symbols (`<span class="material-symbols-rounded">`), nunca SVGs soltos ou emojis.

## Tokens

Tudo em `styles.scss`, organizados em grupos (nomes reais do código):

- **Superficies**: `--background`, `--sidebar`, `--card`, `--card-muted`, `--surface-panel`,
  `--surface-soft`, `--surface-strong`, `--surface-glass` (+ variantes).
- **Contornos**: `--border`, `--divider`, `--ring`.
- **Texto**: `--text-primary`, `--text-strong`, `--text-medium`, `--text-secondary`, `--text-inverse`.
- **Acento**: `--accent`, `--accent-hover`, `--accent-light`.
- **Estado** (indicadores de risco por cor e tom): `--success`, `--danger`, `--warning`,
  e os chips de tom (`--chip-accent-*`, `--chip-warning-*`, `--chip-danger-*`).
- **Escala**: `--space-1..8`; raios `--radius-xs..2xl`/`--radius-pill` (todos `0`); sombras
  `--shadow-soft`/`--shadow-card`/`--shadow-float` (no escuro viram `none`).
- **Layout**: `--page-width`, `--workspace-max-width`, `--shell-padding`, `--section-gap`, safe-areas.
- **Tokens de componente**: familias `--sidebar-*`, `--bottom-nav-*`, `--chip-*`, `--tab-*`,
  `--modal-*`, `--hero-*`, `--highlight-*` etc. Regra: componente particular nao inventa cor —
  expoe token proprio com valor derivado do sistema.

**Regra de ouro**: componente consome `var(--token)`, nunca literal. O app inteiro hoje tem
~630 usos de tokens contra ~44 cores literais, e quase todos os literais restantes estao nas
duas excecoes abaixo.

## Sistema global `proto-*`

O "kit de componentes" e uma familia de ~125 regras globais em `styles.scss` (nao sao componentes
Angular). Os blocos principais:

| Classe | Uso |
| --- | --- |
| `.proto-page` / `.proto-header` | casca da pagina e cabecalho com acao |
| `.proto-surface` (+ `__head`/`__body`) | cartao/painel de conteudo |
| `.proto-metric` / `.proto-grid--*` | KPI do dashboard e grades (two/three/metrics) |
| `.proto-button` (+ `--secondary`/`--ghost`) | acoes |
| `.proto-tag` / `.proto-chip` | badges com tom semantico via `data-tone` |
| `.proto-field` / `.proto-form-grid` | formulario |
| `.proto-table` / `.proto-list` | dados tabulares e listas |
| `.proto-empty` | estado vazio (mascara o antigo `app-empty-state` prometido em versao antiga deste doc) |
| `.proto-auth-card` / `.proto-auth-*` | telas de login/cadastro |
| `.proto-progress`, `.proto-delta`, `.proto-strip`, `.proto-note`, `.proto-muted`, `.proto-inline-title`, `.proto-icon-box` | auxiliares |

**Tons semanticos**: `.proto-tag` e `.proto-chip` aceitam `data-tone='accent|success|warning|danger'`.
Indicador de risco ou status sem tom semantico e bug de design, nao de codigo.

Apoio global nao-`proto` (poucas regras, no mesmo espirito): `.page-stack`, `.muted`,
`.status-positive/negative/warning`, `.skeleton-shimmer`, `.stagger-reveal`, `.consent-row`.

## Componentes

O unico componente real do sistema e o **`app-toast`** (`core/services/toast.service.ts` +
`layout/toast/`, montado no `workspace-shell`): pilha flutuante com auto-dismiss e tons do sistema.
Os antigos `app-panel`, `app-metric-card` e `app-empty-state` desta doc **nunca existiram como
componentes** — o papel deles e das classes `proto-surface`, `proto-metric` e `proto-empty`.

## Excecoes documentadas (literais permitidos)

1. **Landing** (`features/landing`): ilha de marketing com tema proprio, deliberada; os literais
   dela tem comentario no proprio CSS explicando cada escolha.
2. **Cartaz da pagina QR** (`features/qr`): o que vai para o papel e sempre claro — fundo branco,
   texto escuro, QR preto. O que e de tela (fundo da pagina, links, botoes) segue tokens.

Fora dessas duas, cor literal em `.scss` de recurso e violacao.

## Experiencia

- mobile-first, com navegacao lateral no desktop e bottom-nav no mobile (ambas tokenizadas);
- indicadores de risco sempre por cor **e** tom (`data-tone`), nunca cor sozinha;
- dark mode centralizado no bloco `html[data-theme='dark']` — recurso nao reescreve cor para o escuro;
- animacoes curtas via `--transition-base`/`--transition-fast` e utilitarios globais
  (`.stagger-reveal`, `.skeleton-shimmer`), respeitando a estetica clinica.
