-- Ultimo passo TOTP (30s) aceito: cada codigo so vale uma vez (RFC 6238 §5.2).
ALTER TABLE "User" ADD COLUMN "mfaLastTotpStep" INTEGER;
