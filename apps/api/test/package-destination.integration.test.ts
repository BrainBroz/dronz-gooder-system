import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createOperationalFixture } from "./helpers/operational-fixture";

process.env.DATABASE_URL =
  process.env.DATABASE_TEST_URL ??
  "postgresql://postgres:postgres@localhost:5432/dronz_gooder_test?schema=public";
process.env.WEB_ORIGIN = "http://localhost:5173";
process.env.JWT_ACCESS_SECRET = "change-me-access";
process.env.JWT_REFRESH_SECRET = "change-me-refresh";
process.env.JWT_ACCESS_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "30d";

const prisma = new PrismaClient();
let createApp: typeof import("../src/app").createApp;
const cleanups: (() => Promise<unknown>)[] = [];
beforeAll(async () => ({ createApp } = await import("../src/app")));
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
afterAll(() => prisma.$disconnect());

// Pedido com compra de origem, destino padrão Base Miami e dois pacotes com tracking.
async function setup() {
  const store = await prisma.loja.findUniqueOrThrow({
    where: { slug: "dronz" }
  });
  const data = await createOperationalFixture(prisma, store.id);
  const base = await prisma.posicaoOperacional.findUniqueOrThrow({
    where: { id: "posicao-miami-base" }
  });
  const hotel = await prisma.posicaoOperacional.create({
    data: {
      localId: base.localId,
      codigo: `HOTEL-${randomUUID()}`,
      nome: "Hotel viajante",
      tipo: "TEMPORARIA",
      status: "ATIVA",
      inicioEm: new Date(Date.now() - 86_400_000),
      fimEm: new Date(Date.now() + 7 * 86_400_000)
    }
  });
  const purchase = await prisma.compraImportada.create({
    data: {
      numeroPedido: `D15-${randomUUID()}`,
      quantidade: 2,
      plataforma: "MANUAL",
      dataPedido: new Date()
    }
  });
  await prisma.pedidoCompra.update({
    where: { id: data.order.id },
    data: { compraImportadaId: purchase.id, destinoPosicaoId: base.id }
  });
  const shipment = await prisma.envioExterno.create({
    data: {
      compraImportadaId: purchase.id,
      externalShipmentId: "S1",
      ultimaAtualizacaoEm: new Date()
    }
  });
  const [first, second] = await Promise.all(
    ["P1", "P2"].map((externalPackageId, index) =>
      prisma.pacoteExterno.create({
        data: {
          envioExternoId: shipment.id,
          externalPackageId,
          trackings: {
            create: {
              codigo: `1Z00000000${index}`,
              transportadora: "UPS",
              ativo: true,
              ultimaAtualizacaoEm: new Date()
            }
          }
        }
      })
    )
  );
  cleanups.push(async () => {
    await prisma.recebimentoMiami.deleteMany({
      where: { pedidoCompraItemId: data.item.id }
    });
    await prisma.trackingExterno.deleteMany({
      where: { pacote: { envio: { compraImportadaId: purchase.id } } }
    });
    await prisma.pacoteExterno.deleteMany({
      where: { envioExternoId: shipment.id }
    });
    await prisma.envioExterno.deleteMany({ where: { id: shipment.id } });
    await prisma.pedidoCompra.update({
      where: { id: data.order.id },
      data: { compraImportadaId: null }
    });
    await data.cleanup();
    await prisma.compraImportada.delete({ where: { id: purchase.id } });
    await prisma.posicaoOperacional.delete({ where: { id: hotel.id } });
  });
  const app = createApp();
  const login = await request(app)
    .post("/auth/login")
    .send({ email: "admin@example.com", password: "change-me" });
  const headers = {
    Authorization: `Bearer ${login.body.accessToken}`,
    "x-store-id": store.id
  };
  return { app, headers, data, base, hotel, first: first!, second: second! };
}

describe("destino por pacote (D-15)", () => {
  it("pacote herda o destino do pedido e pode ser redirecionado com motivo e auditoria", async () => {
    const { app, headers, data, base, hotel, first } = await setup();
    const list = async () =>
      (
        await request(app)
          .get(`/purchase-orders/${data.order.id}/trackings`)
          .set(headers)
      ).body as { pacoteId: string; destino: { id: string; origem: string } }[];
    expect(
      (await list()).every(
        (t) => t.destino.id === base.id && t.destino.origem === "PEDIDO"
      )
    ).toBe(true);

    const redirect = (body: object) =>
      request(app)
        .put(
          `/purchase-orders/${data.order.id}/packages/${first.id}/destination`
        )
        .set(headers)
        .send(body);
    expect((await redirect({ posicaoId: hotel.id })).status).toBe(400);
    expect(
      (await redirect({ posicaoId: hotel.id, motivo: "Entrega no hotel" }))
        .status
    ).toBe(200);
    const after = await list();
    expect(after.find((t) => t.pacoteId === first.id)!.destino).toMatchObject({
      id: hotel.id,
      origem: "PACOTE"
    });
    expect(after.find((t) => t.pacoteId !== first.id)!.destino.origem).toBe(
      "PEDIDO"
    );
    expect(
      await prisma.auditLog.count({
        where: {
          action: "SET_PACKAGE_DESTINATION",
          entityId: first.id,
          reason: "Entrega no hotel"
        }
      })
    ).toBe(1);

    // Cada posição só exibe os códigos dos pacotes destinados a ela.
    const codes = async (posicaoId: string) =>
      (
        await request(app)
          .get(`/positions/${posicaoId}/availability`)
          .set(headers)
      ).body
        .filter(
          (item: { pedidoCompraItemId: string }) =>
            item.pedidoCompraItemId === data.item.id
        )
        .flatMap((item: { trackings: { codigo: string }[] }) =>
          item.trackings.map((t) => t.codigo)
        );
    expect(await codes(hotel.id)).toEqual(["1Z000000000"]);
    expect(await codes(base.id)).toEqual(["1Z000000001"]);

    // Posição temporária com pacote destinado não pode ser cancelada.
    expect(
      await prisma.pacoteExterno.count({
        where: { destinoPosicaoId: hotel.id }
      })
    ).toBe(1);
    // Voltar ao padrão do pedido.
    expect(
      (await redirect({ posicaoId: null, motivo: "Hotel cancelado" })).status
    ).toBe(200);
    expect((await list()).every((t) => t.destino.origem === "PEDIDO")).toBe(
      true
    );
  });

  it("depois do primeiro recebimento o destino do pacote não muda; pacote de outra compra é 404", async () => {
    const { app, headers, data, hotel, first } = await setup();
    await prisma.recebimentoMiami.create({
      data: {
        lojaId: data.order.lojaId,
        pedidoCompraItemId: data.item.id,
        quantidadeRecebida: 1,
        recebidoEm: new Date(),
        confirmadoPorId: data.admin.id
      }
    });
    const blocked = await request(app)
      .put(`/purchase-orders/${data.order.id}/packages/${first.id}/destination`)
      .set(headers)
      .send({ posicaoId: hotel.id, motivo: "Tarde demais" });
    expect(blocked.body.error).toBe("already_received");
    const other = await request(app)
      .put(`/purchase-orders/${data.order.id}/packages/inexistente/destination`)
      .set(headers)
      .send({ posicaoId: hotel.id, motivo: "Pacote alheio" });
    expect(other.status).toBe(404);
  });
});
