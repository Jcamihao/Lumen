// Minimo para senhas NOVAS (cadastro e redefinicao).
export const AUTH_PASSWORD_MIN_LENGTH = 8;
// O bcrypt so le os 72 primeiros bytes: alem disso a senha seria truncada em silencio.
export const AUTH_PASSWORD_MAX_LENGTH = 72;
// Login continua aceitando senhas antigas de 6 caracteres (criadas antes de o minimo subir).
export const AUTH_LOGIN_PASSWORD_MIN_LENGTH = 6;
// Teto so pra nao gastar CPU/memoria com entrada gigante; NAO pode ser 72, senao quem
// digitou mais que isso no cadastro (o bcrypt truncou) nao conseguiria mais entrar.
export const AUTH_LOGIN_PASSWORD_MAX_LENGTH = 1024;
