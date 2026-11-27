import { IncomingMessage, request as httpRequest } from "http";
import { request as httpsRequest } from "https";

export type JsonResponse = { statusCode: number; body: string };

function collectResponse(response: IncomingMessage, resolve: (value: JsonResponse) => void): void {
  const chunks: Buffer[] = [];
  response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  response.on("end", () =>
    resolve({ statusCode: Number(response.statusCode || 0), body: Buffer.concat(chunks).toString("utf-8") }),
  );
}

/** POST com corpo JSON e limite de tempo. Devolve o status e o corpo como texto. */
export function postJson(
  rawUrl: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(rawUrl);
    const requester = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = requester(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers,
        timeout: timeoutMs,
      },
      (response) => collectResponse(response, resolve),
    );
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("Timeout ao consultar o SelahIA.")));
    request.write(body);
    request.end();
  });
}
