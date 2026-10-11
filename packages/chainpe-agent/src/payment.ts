/**
 * Payment Client (Monad, x402 v2)
 *
 * A thin, receipt-keeping wrapper around the SDK's `paidFetch`. The SDK runs the
 * x402 v2 loop and only signs an offer that is `exact`, on our Monad network,
 * in that network's USDC, and within `maxPerPayment` — so there is no second
 * x402 implementation here.
 */

import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { DEFAULT_NETWORK, explorerTxUrl, normalizeKey, paidFetch } from "@chainpemonad/sdk";

import type {
  PaymentReceipt,
  PaymentToken,
  HttpRequestOptions,
  HttpResponse,
  ServiceInfo,
  ChainPeNetwork,
} from "./types.js";
import { formatAmount, parseAmount } from "./wallet.js";

export interface PaymentClientOptions {
  privateKey: string;
  network?: ChainPeNetwork;
  onPayment?: (receipt: PaymentReceipt) => void;
  /** Max USDC per payment (human string). Defaults to "1". */
  maxPerPayment?: string;
  /** For tests: the fetch implementation to use. */
  fetchImpl?: typeof fetch;
}

export class PaymentClient {
  private readonly account: PrivateKeyAccount;
  private readonly network: ChainPeNetwork;
  private readonly onPayment?: (receipt: PaymentReceipt) => void;
  private readonly maxValueAtomic: bigint;
  private readonly fetchImpl?: typeof fetch;

  private receipts: PaymentReceipt[] = [];

  constructor(options: PaymentClientOptions) {
    this.account = privateKeyToAccount(normalizeKey(options.privateKey));
    this.network = options.network ?? DEFAULT_NETWORK;
    this.onPayment = options.onPayment;
    this.maxValueAtomic = parseAmount(options.maxPerPayment ?? "1");
    this.fetchImpl = options.fetchImpl;
  }

  getAddress(): string {
    return this.account.address;
  }

  getNetwork(): ChainPeNetwork {
    return this.network;
  }

  /** Makes an HTTP request, paying an x402 `402` in Monad USDC if needed. */
  async fetch<T = unknown>(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse<T>> {
    const { method = "GET", headers = {}, body, timeout = 30000 } = options;

    const init: RequestInit = { method, headers: { "Content-Type": "application/json", ...headers } };
    if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);

    const result = await paidFetch({
      url,
      init,
      network: this.network,
      account: this.account,
      maxPerCallAtomic: this.maxValueAtomic,
      timeoutMs: timeout,
      fetchImpl: this.fetchImpl,
    });

    let receipt: PaymentReceipt | undefined;
    if (result.payment) {
      const p = result.payment;
      receipt = {
        txId: p.txHash,
        explorerUrl: p.txHash ? explorerTxUrl(this.network, p.txHash) : undefined,
        network: this.network,
        amount: p.amount,
        token: "USDC",
        recipient: p.recipient,
        timestamp: new Date(),
        service: "Unknown Service",
        path: safePath(url),
      };
      this.receipts.push(receipt);
      this.onPayment?.(receipt);
    }

    const response = result.response;
    const data = await this.parseResponse<T>(response);
    return {
      status: response.status,
      statusText: response.statusText,
      headers: this.headersToObject(response.headers),
      data,
      paid: !!receipt,
      paymentReceipt: receipt,
    };
  }

  /** Makes a request to a known paid service. */
  async callService<T = unknown>(
    service: ServiceInfo,
    path: string = "/",
    options: HttpRequestOptions = {}
  ): Promise<HttpResponse<T>> {
    const url = new URL(path, service.endpoint).toString();
    const response = await this.fetch<T>(url, options);
    if (response.paymentReceipt) response.paymentReceipt.service = service.name;
    return response;
  }

  getReceipts(): PaymentReceipt[] {
    return [...this.receipts];
  }

  getTotalSpent(): Record<PaymentToken, string> {
    let sum = 0n;
    for (const r of this.receipts) sum += parseAmount(r.amount || "0");
    return { USDC: formatAmount(sum) };
  }

  getTransactionCount(): number {
    return this.receipts.length;
  }

  reset(): void {
    this.receipts = [];
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get("Content-Type") || "";
    if (contentType.includes("application/json")) {
      try {
        return (await response.json()) as T;
      } catch {
        return null as T;
      }
    }
    return (await response.text()) as unknown as T;
  }

  private headersToObject(headers: Headers): Record<string, string> {
    const obj: Record<string, string> = {};
    headers.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Creates a payment client. */
export function createPaymentClient(
  privateKey: string,
  options: Partial<PaymentClientOptions> = {}
): PaymentClient {
  return new PaymentClient({ privateKey, ...options });
}
