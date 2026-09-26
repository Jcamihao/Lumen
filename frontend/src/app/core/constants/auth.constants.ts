// Minimo para senhas NOVAS (cadastro e redefinicao).
export const AUTH_PASSWORD_MIN_LENGTH = 8;
// Acima disso o bcrypt do backend truncaria a senha em silencio.
export const AUTH_PASSWORD_MAX_LENGTH = 72;
// Login continua aceitando senhas antigas de 6 caracteres.
export const AUTH_LOGIN_PASSWORD_MIN_LENGTH = 6;
