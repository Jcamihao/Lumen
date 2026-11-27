# Revisao: refatoracao auth.controller.ts (lote 1)

Data: 2026-11-26. Revisor: Claude Sonnet 5.5 (conferencia independente).

## Veredito
Sem mudanca de comportamento. Nenhum defeito real encontrado no codigo de producao.

## Conferido contra HEAD
1. 17 rotas: AuthController (register, login, refresh, logout, logout-all, me), AuthMfaController (verify-login, email-bypass/request, email-bypass/verify, setup, confirm-setup, recovery-codes/regenerate, disable), AuthEmailController (forgot-password, reset-password, verify-email, resend-verification). Metodo HTTP, path, @Public, @ApiBearerAuth, @ApiOperation, DTOs e ordem de efeitos identicos. Os tres usam prefixo auth. Nao ha rota com parametro, entao a ordem entre controllers nao causa colisao.
2. Cookie: httpOnly true, secure ?? false, sameSite ?? lax, domain, path ?? /api/v1/auth, maxAge via parseDurationToMs (duration.ts, nao alterado) com fallback 7d para duracao invalida (try/catch equivale ao antigo "sem match"), clear sem maxAge, so web (trim+lowerCase), MFA passa direto, web nao devolve refreshToken, catch do refresh limpa so se web, logout e logout-all limpam sempre antes de chamar o servico.
3. auth.module.ts: 3 controllers e RefreshCookieService nos providers. ConfigService e global (ja usado). tsc limpo; teste instancia sem erro de DI nos controllers.
4. Tamanho: todos os arquivos <=118 linhas, funcoes <=20 linhas. Sem duplicacao (opcoes de cookie em baseOptions). Nomes claros. Responsabilidade do cookie isolada no servico (SRP).

## Mutantes (npx jest src/auth, 27 no total)
Mortos de primeira (23): httpOnly false; secure ?? para ||; sameSite default; path default; sem toLowerCase; sem trim; shouldUse invertido; fallback 7d para 1d; fallback devolve 0; default expiresIn 7d para 1d; web devolve refreshToken no corpo; clear com maxAge; cookie sem maxAge; logout sem clear; logoutAll sem clear; refresh catch sempre limpa; refresh catch nunca limpa; sem @Public em login; sem @Public em refresh; @Public em logout; path mfa/disable trocado; me como POST; @Public em resend-verification.
Sobreviventes (4): register, login, verify-login e email-bypass/verify sem chamar attach (devolviam refreshToken no corpo). Mortos depois dos testes novos em auth.controller.spec.ts e auth-mfa.controller.spec.ts.
Equivalentes: nenhum.
Cada mutante foi revertido; arquivos conferidos byte a byte contra copia em /tmp/claude-1000/scratch-auth-review/orig.

## Testes novos
- src/auth/auth-controllers.routes.spec.ts (54 linhas): metadata Reflect, 17 rotas com metodo, path, publico, prefixo auth.
- src/auth/auth.controller.spec.ts (68): register/login usam attach; refresh (sucesso, falha web limpa, falha nao-web nao limpa); logout/logout-all limpam.
- src/auth/auth-mfa.controller.spec.ts (30): verify-login e email-bypass/verify usam attach.

## Resultado final (2026-11-26)
- npx tsc --noEmit | grep '^src/auth': vazio.
- npx jest src/auth: 9 suites, 84 testes verdes.

## NAO verificado
- @ApiOperation, @ApiBearerAuth e DTOs (@Body) nao tem teste; conferidos so por leitura do diff.
- Guard global JWT respeitando @Public: nao rodei e2e/HTTP real com o app subido.
- Cookie real via Express (Set-Cookie): so com response simulada.
- Fusos (TZ) e repeticao 15x: sem logica de data nos itens novos, nao rodei.
- Suite completa fora de src/auth e graphify update: nao rodei.
