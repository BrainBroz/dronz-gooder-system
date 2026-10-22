import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server as HttpsServer } from "node:https";
import type { AddressInfo, Server } from "node:net";
import Test from "supertest/lib/test.js";

// supertest escuta em `::` mas conecta em 127.0.0.1 na mesma porta. No macOS, outro app local pode já
// ocupar essa porta em 127.0.0.1 e o teste fala com ele ("socket hang up", 405). Conectar pela família
// em que o servidor de teste realmente escuta evita a colisão.
Test.prototype.serverAddress = function (
  this: { _server?: Server },
  app: Server,
  path: string
) {
  if (!app.address()) this._server = app.listen(0);
  const { port, family } = app.address() as AddressInfo;
  const host = family === "IPv6" ? "[::1]" : "127.0.0.1";
  return `${app instanceof HttpsServer ? "https" : "http"}://${host}:${port}${path}`;
};

// Testes nunca leem os segredos reais da máquina (token do eBay, chave do Parcel) nem falam com esses serviços.
process.env.MARKETPLACE_SECRET_DIR ??= mkdtempSync(path.join(os.tmpdir(), "dronz-test-secrets-"));
delete process.env.PARCEL_API_KEY;
