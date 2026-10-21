import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

process.env.DATABASE_URL = process.env.DATABASE_TEST_URL ?? "postgresql://postgres:postgres@localhost:5432/dronz_gooder_test?schema=public";
process.env.NODE_ENV = "test";

const prisma = new PrismaClient();
type Service = typeof import("../src/modules/marketplace-integrations/parcel-tracking.service");
let normalizeTracking: Service["normalizeTracking"];
let parcelApiKey: Service["parcelApiKey"];
let resetParcelThrottle: Service["resetParcelThrottle"];
let statusLabel: Service["statusLabel"];
let syncParcelStatuses: Service["syncParcelStatuses"];
beforeAll(async () => {
  ({ normalizeTracking, parcelApiKey, resetParcelThrottle, statusLabel, syncParcelStatuses } = await import("../src/modules/marketplace-integrations/parcel-tracking.service"));
});
afterAll(() => prisma.$disconnect());
const CODES = ["PARCELTEST-AAA", "PARCELTEST-BBB"];

const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const delivery = (code: string, status: number, events: { event: string; date: string; location?: string }[] = []) => ({ tracking_number: code, carrier_code: "usps", status_code: status, date_expected: "2026-10-12", events });

beforeEach(async () => {
  resetParcelThrottle();
  vi.stubEnv("PARCEL_API_KEY", "chave-de-teste");
  await prisma.statusRastreio.deleteMany({ where: { codigo: { in: CODES } } });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await prisma.statusRastreio.deleteMany({ where: { codigo: { in: CODES } } });
});

describe("Parcel: status de entrega dos rastreios", () => {
  it("lê as entregas recentes e grava o último evento de cada rastreio, contando novos, mudados e iguais", async () => {
    const fetchMock = reply({ success: true, deliveries: [delivery(" parceltest-aaa ", 2, [{ event: "In Transit", date: "2026-10-10 08:00", location: "Miami, FL" }, { event: "Accepted", date: "2026-10-09 10:00" }]), delivery("PARCELTEST-BBB", 0, [{ event: "Delivered", date: "2026-10-11 14:30", location: "Doral, FL" }])] });
    expect(await syncParcelStatuses(fetchMock, new Date("2026-10-21T12:00:00Z"))).toEqual({ novos: 2, mudaram: 0, iguais: 0, pulado: false });
    const [url, init] = (fetchMock as unknown as { mock: { calls: [string, { headers: Record<string, string> }][] } }).mock.calls[0]!;
    expect(url).toBe("https://api.parcel.app/external/deliveries/?filter_mode=recent");
    expect(init.headers).toEqual({ "api-key": "chave-de-teste" });
    expect(await prisma.statusRastreio.findUniqueOrThrow({ where: { codigo: "PARCELTEST-AAA" } })).toMatchObject({ transportadora: "usps", statusCodigo: 2, ultimoEvento: "In Transit", ultimoEventoLocal: "Miami, FL", ultimoEventoData: "2026-10-10 08:00", previstaEm: "2026-10-12" });
    expect(await prisma.statusRastreio.findUniqueOrThrow({ where: { codigo: "PARCELTEST-BBB" } })).toMatchObject({ statusCodigo: 0, ultimoEvento: "Delivered" });

    resetParcelThrottle();
    const again = reply({ success: true, deliveries: [delivery("PARCELTEST-AAA", 0, [{ event: "Delivered", date: "2026-10-12 09:00" }]), delivery("PARCELTEST-BBB", 0, [{ event: "Delivered", date: "2026-10-11 14:30", location: "Doral, FL" }])] });
    expect(await syncParcelStatuses(again)).toEqual({ novos: 0, mudaram: 1, iguais: 1, pulado: false });
    expect(await prisma.statusRastreio.findUniqueOrThrow({ where: { codigo: "PARCELTEST-AAA" } })).toMatchObject({ statusCodigo: 0, ultimoEvento: "Delivered" });
  });

  it("sem chave fica desligado; com chave não consulta duas vezes em menos de 3 minutos", async () => {
    vi.stubEnv("PARCEL_API_KEY", "");
    vi.stubEnv("MARKETPLACE_SECRET_DIR", mkdtempSync(path.join(os.tmpdir(), "parcel-vazio-")));
    const fetchMock = reply({ success: true, deliveries: [] });
    expect(await syncParcelStatuses(fetchMock)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv("PARCEL_API_KEY", "chave-de-teste");
    const first = await syncParcelStatuses(fetchMock, new Date("2026-10-21T12:00:00Z"));
    expect(first).toMatchObject({ pulado: false });
    expect(await syncParcelStatuses(fetchMock, new Date("2026-10-21T12:01:00Z"))).toMatchObject({ pulado: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await syncParcelStatuses(fetchMock, new Date("2026-10-21T12:04:00Z"))).toMatchObject({ pulado: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lê a chave do arquivo da pasta de segredos quando não está no ambiente", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "parcel-chave-"));
    writeFileSync(path.join(directory, "parcel-api-key"), "chave-do-arquivo\n", { mode: 0o600 });
    vi.stubEnv("PARCEL_API_KEY", "");
    vi.stubEnv("MARKETPLACE_SECRET_DIR", directory);
    expect(await parcelApiKey()).toBe("chave-do-arquivo");
  });

  it("chave recusada e serviço fora do ar viram erros claros, sem gravar nada", async () => {
    await expect(syncParcelStatuses(reply({ success: false, error_message: "Invalid API key" }, 401))).rejects.toMatchObject({ code: "parcel_rejected" });
    resetParcelThrottle();
    await expect(syncParcelStatuses(vi.fn(async () => { throw new Error("rede"); }) as unknown as typeof fetch)).rejects.toMatchObject({ code: "parcel_unavailable" });
    resetParcelThrottle();
    await expect(syncParcelStatuses(vi.fn(async () => new Response("<html>502</html>", { status: 502 })) as unknown as typeof fetch)).rejects.toMatchObject({ code: "parcel_unavailable" });
    resetParcelThrottle();
    await expect(syncParcelStatuses(reply({ qualquer: "coisa" }))).rejects.toMatchObject({ code: "parcel_unavailable" });
    expect(await prisma.statusRastreio.count({ where: { codigo: { in: CODES } } })).toBe(0);
  });

  it("normaliza o código e traduz os status do Parcel", () => {
    expect(normalizeTracking(" 9400 1112 abc ")).toBe("940011 12ABC".replace(" ", ""));
    expect([0, 2, 4, 7, 99].map(statusLabel)).toEqual(["Entregue", "Em trânsito", "Saiu para entrega", "Exceção", "Status desconhecido"]);
  });
});
