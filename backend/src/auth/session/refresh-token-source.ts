import { UnauthorizedException } from "@nestjs/common";
import { RequestWithContext } from "../../common/interfaces/request-with-context.interface";
import { RefreshDto } from "../dto/refresh.dto";

function getCookieValue(request: RequestWithContext | undefined, cookieName: string): string | null {
  const rawCookieHeader = request?.headers.cookie;
  const headerValue = Array.isArray(rawCookieHeader) ? rawCookieHeader.join(";") : rawCookieHeader;
  if (!headerValue) return null;

  const cookieEntry = headerValue
    .split(";")
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk.startsWith(`${cookieName}=`));
  if (!cookieEntry) return null;

  return decodeURIComponent(cookieEntry.slice(cookieName.length + 1));
}

/** Refresh token do corpo da requisicao; senao do cookie. */
export function resolveRefreshToken(
  dto: RefreshDto,
  request: RequestWithContext | undefined,
  cookieName: string | undefined,
): string {
  const bodyRefreshToken = dto.refreshToken?.trim();
  if (bodyRefreshToken) return bodyRefreshToken;

  const cookieRefreshToken = cookieName ? getCookieValue(request, cookieName) : null;
  if (cookieRefreshToken) return cookieRefreshToken;

  throw new UnauthorizedException("Refresh token ausente.");
}
