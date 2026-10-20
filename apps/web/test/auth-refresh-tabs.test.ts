import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Servidor com a regra do backend: o token atual é consumido e substituído; o token recém-substituído
// recebe 409 refresh_concorrente; qualquer outro, 401. O navegador só grava o cookie novo quando a
// resposta chega (deliveryMs depois do commit), como num cookie atrasado.
const server = vi.hoisted(() => {
  const state = { jar: "t0", valid: "t0", replaced: null as string | null, seq: 0, deliveryMs: 0, active: 0, maxActive: 0, statuses: [] as number[], hangNext: false, calls: 0 };
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  return {
    state,
    reset(deliveryMs: number) {
      Object.assign(state, { jar: "t0", valid: "t0", replaced: null, seq: 0, deliveryMs, active: 0, maxActive: 0, statuses: [], hangNext: false, calls: 0 });
    },
    async refresh(reject: (status: number) => never, signal?: AbortSignal, cancel?: () => never) {
      state.calls++;
      if (state.hangNext) {
        // Conexão pendurada: só termina quando o cliente cancela.
        state.hangNext = false;
        await new Promise((resolve) => signal?.addEventListener("abort", resolve));
        return cancel!();
      }
      state.active++;
      state.maxActive = Math.max(state.maxActive, state.active);
      try {
        const sent = state.jar;
        await sleep(5);
        if (sent === state.valid) {
          state.replaced = sent;
          const next = `t${++state.seq}`;
          state.valid = next;
          await sleep(state.deliveryMs);
          state.jar = next;
          state.statuses.push(200);
          return { data: { accessToken: `acesso-${next}` } };
        }
        const status = sent === state.replaced ? 409 : 401;
        state.statuses.push(status);
        return reject(status);
      } finally {
        state.active--;
      }
    }
  };
});

vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("axios")>();
  const reject = (status: number): never => {
    throw new actual.AxiosError("falha", "ERR_BAD_RESPONSE", undefined, undefined, {
      status,
      statusText: "",
      data: { error: status === 409 ? "refresh_concorrente" : "invalid_refresh_token" },
      headers: {},
      config: { headers: new actual.AxiosHeaders() }
    });
  };
  const cancel = (): never => {
    throw new actual.CanceledError();
  };
  const post = (url: string, ...rest: unknown[]) =>
    url.includes("/auth/refresh")
      ? server.refresh(reject, (rest[1] as { signal?: AbortSignal } | undefined)?.signal, cancel)
      : (actual.default.post as (...a: unknown[]) => unknown)(url, ...rest);
  return { ...actual, default: { ...actual.default, post } };
});

/** Web Locks mínimo: uma fila por nome, como o navegador faz entre abas da mesma origem. */
function installLocks() {
  let tail: Promise<unknown> = Promise.resolve();
  const locks = {
    request: (_name: string, callback: () => Promise<unknown>) => {
      const run = tail.then(callback);
      tail = run.catch(() => undefined);
      return run;
    }
  };
  Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
}

/** Cada aba tem sua própria instância do cliente e do estado de sessão. */
async function openTab() {
  vi.resetModules();
  return import("../src/api/client");
}

beforeEach(() => vi.useRealTimers());
afterEach(() => {
  Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });
});

describe("renovação de sessão entre abas", () => {
  it("três abas ao mesmo tempo: com a trava entre abas, todas renovam, uma de cada vez, sem 409", async () => {
    server.reset(20);
    installLocks();
    const tabs = [await openTab(), await openTab(), await openTab()];
    const tokens = await Promise.all(tabs.map((tab) => tab.refreshAccessTokenOnce()));
    expect(tokens.every((token) => token !== null)).toBe(true);
    expect(server.state.statuses).toEqual([200, 200, 200]);
    expect(server.state.maxActive).toBe(1);
  });

  it("cookie atrasado além da espera do retry: a trava só libera depois que o cookie chegou", async () => {
    server.reset(600);
    installLocks();
    const [a, b] = [await openTab(), await openTab()];
    const tokens = await Promise.all([a.refreshAccessTokenOnce(), b.refreshAccessTokenOnce()]);
    expect(tokens.every((token) => token !== null)).toBe(true);
    expect(server.state.statuses).toEqual([200, 200]);
  });

  it("renovação pendurada é cancelada no prazo e libera a trava para as outras abas", async () => {
    vi.useFakeTimers();
    server.reset(0);
    server.state.hangNext = true;
    installLocks();
    const [a, b] = [await openTab(), await openTab()];
    const first = a.refreshAccessTokenOnce();
    const second = b.refreshAccessTokenOnce();
    await vi.advanceTimersByTimeAsync(9_000);
    // Antes do prazo, a outra aba segue esperando a trava.
    expect(server.state.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1_100);
    await expect(first).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(50);
    await expect(second).resolves.toBe("acesso-t1");
    expect(server.state.calls).toBe(2);
    vi.useRealTimers();
  });

  it("sem Web Locks e com cookie atrasado além da primeira espera, as tentativas limitadas ainda recuperam a sessão", async () => {
    server.reset(600);
    const [a, b] = [await openTab(), await openTab()];
    const tokens = await Promise.all([a.refreshAccessTokenOnce(), b.refreshAccessTokenOnce()]);
    expect(tokens.every((token) => token !== null)).toBe(true);
    expect(server.state.statuses.filter((status) => status === 409).length).toBeGreaterThanOrEqual(1);
  }, 10_000);

  it("sem Web Locks, duas abas ainda se recuperam pelas novas tentativas do 409", async () => {
    server.reset(20);
    const [a, b] = [await openTab(), await openTab()];
    const tokens = await Promise.all([a.refreshAccessTokenOnce(), b.refreshAccessTokenOnce()]);
    expect(tokens.every((token) => token !== null)).toBe(true);
    expect(server.state.statuses).toContain(409);
  });
});
