import { lookup } from "node:dns/promises";
import { request } from "node:http";
import { isIP } from "node:net";
import {
  providerResponseSchema,
  type ProviderBoundaryFailureCode,
  type ProviderResponse,
  type SignedProviderEnvelope,
} from "./schemas.js";

export interface LoopbackProviderEndpointConfig {
  readonly endpoint: string;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly callbackBytes: number;
  readonly timeoutMs: number;
  readonly maximumRetries: number;
}

export class ProviderBoundaryError extends Error {
  public constructor(public readonly code: ProviderBoundaryFailureCode) {
    super(code);
    this.name = "ProviderBoundaryError";
  }
}

function fail(code: ProviderBoundaryFailureCode): never {
  throw new ProviderBoundaryError(code);
}

async function resolveLoopbackEndpoint(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail("PROVIDER_ENDPOINT_INVALID");
  }
  if (
    url.protocol !== "http:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.port === ""
  ) {
    return fail("PROVIDER_ENDPOINT_INVALID");
  }
  const hostname = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (hostname === "127.0.0.1" || hostname === "::1") return url;
  if (hostname !== "localhost" || isIP(hostname) !== 0) {
    return fail("PROVIDER_DESTINATION_NOT_LOOPBACK");
  }
  let addresses: readonly { address: string; family: number }[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return fail("PROVIDER_DESTINATION_NOT_LOOPBACK");
  }
  if (addresses.length === 0 || addresses.some(({ address }) => address !== "127.0.0.1" && address !== "::1")) {
    return fail("PROVIDER_DESTINATION_NOT_LOOPBACK");
  }
  const chosen = addresses.find(({ address }) => address === "127.0.0.1") ?? addresses[0];
  if (chosen === undefined) return fail("PROVIDER_DESTINATION_NOT_LOOPBACK");
  url.hostname = chosen.family === 6 ? `[${chosen.address}]` : chosen.address;
  return url;
}

function validateBounds(config: LoopbackProviderEndpointConfig): void {
  const bounds = [config.requestBytes, config.responseBytes, config.callbackBytes, config.timeoutMs];
  if (bounds.some((value) => !Number.isInteger(value) || value <= 0) ||
      !Number.isInteger(config.maximumRetries) || config.maximumRetries < 0 || config.maximumRetries > 3) {
    fail("PROVIDER_ENDPOINT_INVALID");
  }
}

interface HttpResult {
  readonly statusCode: number;
  readonly body: unknown;
}

export class LoopbackProviderHttpClient {
  private constructor(
    private readonly endpoint: URL,
    private readonly config: LoopbackProviderEndpointConfig,
  ) {}

  public static async connect(config: LoopbackProviderEndpointConfig): Promise<LoopbackProviderHttpClient> {
    validateBounds(config);
    return new LoopbackProviderHttpClient(await resolveLoopbackEndpoint(config.endpoint), { ...config });
  }

  private exchange(method: "GET" | "POST", path: string, input: unknown, limit: number): Promise<HttpResult> {
    const serialized = method === "POST" ? JSON.stringify(input) : "";
    if (Buffer.byteLength(serialized) > this.config.requestBytes) {
      return Promise.reject(new ProviderBoundaryError("PROVIDER_REQUEST_TOO_LARGE"));
    }
    return new Promise((resolve, reject) => {
      const target = new URL(path, this.endpoint);
      const req = request(target, {
        method,
        headers: method === "POST"
          ? { "content-type": "application/json", "content-length": Buffer.byteLength(serialized) }
          : {},
      }, (response) => {
        const statusCode = response.statusCode ?? 0;
        if (statusCode >= 300 && statusCode < 400) {
          response.resume();
          reject(new ProviderBoundaryError("PROVIDER_REDIRECT_REJECTED"));
          return;
        }
        const chunks: Buffer[] = [];
        let length = 0;
        response.on("data", (chunk: Buffer) => {
          length += chunk.length;
          if (length > limit) {
            response.destroy();
            reject(new ProviderBoundaryError(path.includes("callback")
              ? "PROVIDER_CALLBACK_TOO_LARGE"
              : "PROVIDER_RESPONSE_TOO_LARGE"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          try {
            resolve({ statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown });
          } catch {
            reject(new ProviderBoundaryError("PROVIDER_RESPONSE_MALFORMED"));
          }
        });
      });
      req.setTimeout(this.config.timeoutMs, () => {
        req.destroy(new ProviderBoundaryError("PROVIDER_TIMEOUT"));
      });
      req.on("error", (error) => {
        reject(error instanceof ProviderBoundaryError
          ? error
          : new ProviderBoundaryError("PROVIDER_NETWORK_FAILURE"));
      });
      if (serialized !== "") req.write(serialized);
      req.end();
    });
  }

  public async send(envelope: SignedProviderEnvelope): Promise<ProviderResponse> {
    const response = await this.exchange("POST", "/v1/transport/send", envelope, this.config.responseBytes);
    const parsed = providerResponseSchema.safeParse(response.body);
    if (!parsed.success) fail("PROVIDER_RESPONSE_MALFORMED");
    return parsed.data;
  }

  public async callbacks(): Promise<readonly unknown[]> {
    const response = await this.exchange("GET", "/v1/transport/callbacks", undefined, this.config.callbackBytes);
    if (typeof response.body !== "object" || response.body === null || !("callbacks" in response.body) ||
        !Array.isArray(response.body.callbacks)) {
      return fail("PROVIDER_RESPONSE_MALFORMED");
    }
    return response.body.callbacks as readonly unknown[];
  }

  public maximumAttempts(): number {
    return this.config.maximumRetries + 1;
  }
}
