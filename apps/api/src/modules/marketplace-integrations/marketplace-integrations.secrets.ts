import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface SecretProvider {
  get(reference: string): Promise<string | null>;
}

const allowedEnvironmentReference = /^env:(MARKETPLACE_[A-Z0-9_]+)$/;
const fileReference = /^file:(ebay-[a-z0-9]+)$/;

export class EnvironmentSecretProvider implements SecretProvider {
  async get(reference: string): Promise<string | null> {
    const match = allowedEnvironmentReference.exec(reference);
    if (!match) return null;
    return process.env[match[1]] ?? null;
  }
}

/** Credenciais do aplicativo eBay (uma por instalação, valem para todas as contas): só no ambiente, nunca no banco. */
export type EbayApp = { clientId: string; clientSecret: string; ruName: string };
export function ebayAppFromEnvironment(): EbayApp | null {
  try {
    const value = JSON.parse(process.env.MARKETPLACE_EBAY_APP ?? "") as Partial<EbayApp>;
    return value.clientId && value.clientSecret && value.ruName ? (value as EbayApp) : null;
  } catch {
    return null;
  }
}

export const secretDirectory = () => process.env.MARKETPLACE_SECRET_DIR ?? path.join(os.homedir(), ".dronz-gooder", "secrets");

/**
 * `file:ebay-<id>`: refresh token gravado pelo fluxo de conexão numa pasta fora do repositório (modo 0600).
 * As credenciais do aplicativo continuam só no ambiente; aqui elas são juntadas ao token na leitura.
 * shortcut: arquivo local serve a desenvolvimento e a uma máquina só; produção troca por secret manager.
 */
export class FileSecretProvider implements SecretProvider {
  async get(reference: string): Promise<string | null> {
    const match = fileReference.exec(reference);
    const app = ebayAppFromEnvironment();
    if (!match || !app) return null;
    try {
      const stored = JSON.parse(await readFile(path.join(secretDirectory(), `${match[1]}.json`), "utf8")) as { refreshToken?: string };
      return stored.refreshToken ? JSON.stringify({ clientId: app.clientId, clientSecret: app.clientSecret, refreshToken: stored.refreshToken }) : null;
    } catch {
      return null;
    }
  }
}

export class CompositeSecretProvider implements SecretProvider {
  constructor(private readonly providers: SecretProvider[]) {}
  async get(reference: string): Promise<string | null> {
    for (const provider of this.providers) {
      const value = await provider.get(reference);
      if (value) return value;
    }
    return null;
  }
}

export async function writeEbayRefreshToken(connectionId: string, data: { refreshToken: string; refreshTokenExpiresAt: string }) {
  const directory = secretDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `ebay-${connectionId}.json`);
  await writeFile(file, JSON.stringify(data), { mode: 0o600 });
  await chmod(file, 0o600);
  return `file:ebay-${connectionId}`;
}

export const secretProvider: SecretProvider = new CompositeSecretProvider([new EnvironmentSecretProvider(), new FileSecretProvider()]);
