import { RequestWithContext } from "../../common/interfaces/request-with-context.interface";
import { SessionContext } from "./session.types";

/** IP e user-agent da requisicao, com tamanho limitado, para registrar na sessao. */
export function extractSessionContext(request?: RequestWithContext): SessionContext {
  // request.ip ja respeita o "trust proxy" do Express; o 1o item do X-Forwarded-For
  // vem do proprio cliente e pode ser forjado.
  const rawIp = request?.ip?.trim() || null;
  const rawUserAgent = request?.headers["user-agent"];
  const userAgent = Array.isArray(rawUserAgent) ? rawUserAgent[0] : rawUserAgent ?? null;

  return {
    ipAddress: rawIp ? rawIp.slice(0, 120) : null,
    userAgent: userAgent ? userAgent.slice(0, 512) : null,
  };
}
