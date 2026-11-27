import * as http from "node:http";
import type { IncomingMessage } from "node:http";
import * as https from "node:https";

export type MailTransportResponse = { statusCode: number; body: string };

function collectResponse(response: IncomingMessage, resolve: (value: MailTransportResponse) => void): void {
  const chunks: Buffer[] = [];
  response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  response.on("end", () =>
    resolve({ statusCode: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
  );
}

function requestOptions(url: URL, apiKey: string, body: string): http.RequestOptions {
  return {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port ? parseInt(url.port, 10) : undefined,
    path: `${url.pathname}${url.search}`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      Accept: "application/json",
    },
  };
}

/** POST JSON autenticado (Bearer) com limite de tempo. */
export function postResendJson(
  urlString: string,
  apiKey: string,
  body: string,
  timeoutMs: number,
): Promise<MailTransportResponse> {
  const url = new URL(urlString);
  const requestImpl = url.protocol === "https:" ? https.request : http.request;

  return new Promise((resolve, reject) => {
    const request = requestImpl(requestOptions(url, apiKey, body), (response) => collectResponse(response, resolve));
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Timeout ao enviar email para o Resend (${timeoutMs}ms).`));
    });
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}
