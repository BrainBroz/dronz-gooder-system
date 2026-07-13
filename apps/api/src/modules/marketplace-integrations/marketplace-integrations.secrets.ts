export interface SecretProvider {
  get(reference: string): Promise<string | null>;
}

const allowedEnvironmentReference = /^env:(MARKETPLACE_[A-Z0-9_]+)$/;

export class EnvironmentSecretProvider implements SecretProvider {
  async get(reference: string): Promise<string | null> {
    const match = allowedEnvironmentReference.exec(reference);
    if (!match) return null;
    return process.env[match[1]] ?? null;
  }
}

export const secretProvider: SecretProvider = new EnvironmentSecretProvider();
