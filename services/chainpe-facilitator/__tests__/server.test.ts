import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";

// Module reads these at import time — set before the dynamic import below.
process.env.NODE_ENV = "test";
process.env.NETWORK = "fuji";
// Public Hardhat test key (not a real secret) — only to derive the address.
process.env.FACILITATOR_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

let server: Server;
let base: string;

beforeAll(async () => {
  const { createApp } = await import("../src/server.ts");
  await new Promise<void>((resolve) => {
    server = createApp().listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server?.close();
});

describe("facilitator HTTP contract", () => {
  it("GET /health is a cheap liveness check", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.custodial).toBe(false);
    expect(body.facilitator.toLowerCase()).toBe(ADDR.toLowerCase());
  });

  it("GET /supported advertises exact/avalanche-fuji", async () => {
    const res = await fetch(`${base}/supported`);
    const body = await res.json();
    expect(body.kinds).toEqual([
      { x402Version: 1, scheme: "exact", network: "avalanche-fuji" },
    ]);
  });

  it("GET / lists the endpoints", async () => {
    const res = await fetch(`${base}/`);
    const body = await res.json();
    expect(body.service).toBe("chainpe-facilitator");
    expect(body.endpoints).toContain("/settle");
  });

  it("POST /verify rejects a malformed payload with a 400", async () => {
    const res = await fetch(`${base}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentPayload: {}, paymentRequirements: {} }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.isValid).toBe(false);
    expect(String(body.invalidReason)).toContain("verify_error");
  });
});
