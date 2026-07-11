import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";

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

beforeAll(async () => {
  ({ createApp } = await import("../src/app"));
});

beforeEach(async () => {
  await prisma.recebimentoMiami.deleteMany({});
  await prisma.pedidoCompraItem.updateMany({
    data: { quantidadeRecebidaMiami: 0 }
  });
  await prisma.pedidoCompra.updateMany({
    where: { numeroPedido: { startsWith: "BATCH3_0_" } },
    data: { status: "DRAFT" }
  });
});

afterAll(async () => {
  await prisma.recebimentoMiami.deleteMany({});
  await prisma.pedidoCompra.deleteMany({
    where: { numeroPedido: { startsWith: "BATCH3_0_" } }
  });
  await prisma.$disconnect();
});

async function session() {
  const app = createApp();
  const login = await request(app)
    .post("/auth/login")
    .send({ email: "admin@example.com", password: "change-me" });
  const d = login.body.stores.find((x: { slug: string }) => x.slug === "dronz");
  const g = login.body.stores.find((x: { slug: string }) => x.slug === "gooder");
  const h = (id: string) => ({
    Authorization: `Bearer ${login.body.accessToken}`,
    "x-store-id": id
  });
  return { app, d, g, h, userId: login.body.id };
}

describe("Batch 3.0 — Check-in Miami", () => {
  it("busca pedidos por número", async () => {
    const { app, d, h } = await session();
    const prod = await prisma.produto.findFirstOrThrow({
      where: { lojaId: d.id }
    });
    const supp = await prisma.fornecedor.findFirstOrThrow({
      where: { lojaId: d.id }
    });

    const order = await request(app)
      .post("/purchase-orders")
      .set(h(d.id))
      .send({
        fornecedorId: supp.id,
        numeroPedido: "BATCH3_0_SEARCH_001",
        dataCompra: "2026-01-01",
        moeda: "USD",
        itens: [
          {
            produtoId: prod.id,
            quantidade: 2,
            precoUnitario: 100,
            descontoItem: 0
          }
        ]
      });

    expect(order.status).toBe(201);

    const search1 = await request(app)
      .get("/purchase-orders/search/numero?numero=SEARCH_001")
      .set(h(d.id));

    expect(search1.status).toBe(200);
    expect(Array.isArray(search1.body)).toBe(true);
    expect(search1.body.length).toBeGreaterThan(0);
    expect(search1.body.some((o: { numeroPedido: string }) => o.numeroPedido === "BATCH3_0_SEARCH_001")).toBe(true);

    const search2 = await request(app)
      .get("/purchase-orders/search/numero?numero=INVALID")
      .set(h(d.id));

    expect(search2.status).toBe(200);
    expect(search2.body.length).toBe(0);
  });

  it("registra recebimento completo em Miami com tipo divergência", async () => {
    const { app, d, h } = await session();
    const item = await prisma.pedidoCompraItem.findFirstOrThrow({
      where: { lojaId: d.id }
    });

    const confirmacao = await request(app)
      .post("/logistics/miami-confirmations")
      .set(h(d.id))
      .send({
        pedidoCompraItemId: item.id,
        quantidadeRecebida: item.quantidade,
        recebidoEm: new Date().toISOString(),
        observacao: "Recebimento correto",
        tipoDivergencia: "CORRETO"
      });

    expect(confirmacao.status).toBe(200);
    expect(confirmacao.body.tipoDivergencia).toBe("CORRETO");
    expect(confirmacao.body.quantidadeRecebida).toBe(item.quantidade);

    const updated = await prisma.pedidoCompraItem.findUniqueOrThrow({
      where: { id: item.id }
    });
    expect(updated.quantidadeRecebidaMiami).toBe(item.quantidade);

    const ordem = await prisma.pedidoCompra.findUniqueOrThrow({
      where: { id: item.pedidoCompraId }
    });
    expect(ordem.status).toBe("RECEIVED_MIAMI");
  });

  it("registra recebimento parcial em Miami", async () => {
    const { app, d, h } = await session();
    let item = await prisma.pedidoCompraItem.findFirstOrThrow({
      where: { lojaId: d.id }
    });

    await prisma.pedidoCompraItem.update({
      where: { id: item.id },
      data: { quantidade: 5 }
    });

    item = await prisma.pedidoCompraItem.findUniqueOrThrow({
      where: { id: item.id }
    });

    const confirmacao1 = await request(app)
      .post("/logistics/miami-confirmations")
      .set(h(d.id))
      .send({
        pedidoCompraItemId: item.id,
        quantidadeRecebida: 2,
        recebidoEm: new Date().toISOString(),
        tipoDivergencia: "CORRETO"
      });

    expect(confirmacao1.status).toBe(200);

    const ordem1 = await prisma.pedidoCompra.findUniqueOrThrow({
      where: { id: item.pedidoCompraId }
    });
    expect(ordem1.status).toBe("PARTIALLY_RECEIVED_MIAMI");

    const confirmacao2 = await request(app)
      .post("/logistics/miami-confirmations")
      .set(h(d.id))
      .send({
        pedidoCompraItemId: item.id,
        quantidadeRecebida: 3,
        recebidoEm: new Date().toISOString(),
        tipoDivergencia: "CORRETO"
      });

    expect(confirmacao2.status).toBe(200);

    const ordem2 = await prisma.pedidoCompra.findUniqueOrThrow({
      where: { id: item.pedidoCompraId }
    });
    expect(ordem2.status).toBe("RECEIVED_MIAMI");
  });

  it("registra divergência (item faltante)", async () => {
    const { app, d, h } = await session();
    let item = await prisma.pedidoCompraItem.findFirstOrThrow({
      where: { lojaId: d.id }
    });

    await prisma.pedidoCompraItem.update({
      where: { id: item.id },
      data: { quantidade: 10 }
    });

    item = await prisma.pedidoCompraItem.findUniqueOrThrow({
      where: { id: item.id }
    });

    const confirmacao = await request(app)
      .post("/logistics/miami-confirmations")
      .set(h(d.id))
      .send({
        pedidoCompraItemId: item.id,
        quantidadeRecebida: 0,
        recebidoEm: new Date().toISOString(),
        observacao: "Item não chegou",
        tipoDivergencia: "FALTANTE"
      });

    expect(confirmacao.status).toBe(400);
  });

  it("registra divergência (quantidade divergente)", async () => {
    const { app, d, h } = await session();
    let item = await prisma.pedidoCompraItem.findFirstOrThrow({
      where: { lojaId: d.id }
    });

    await prisma.pedidoCompraItem.update({
      where: { id: item.id },
      data: { quantidade: 10 }
    });

    item = await prisma.pedidoCompraItem.findUniqueOrThrow({
      where: { id: item.id }
    });

    const confirmacao = await request(app)
      .post("/logistics/miami-confirmations")
      .set(h(d.id))
      .send({
        pedidoCompraItemId: item.id,
        quantidadeRecebida: 5,
        recebidoEm: new Date().toISOString(),
        observacao: "Recebida quantidade menor que a esperada",
        tipoDivergencia: "QUANTIDADE_DIVERGENTE"
      });

    expect(confirmacao.status).toBe(200);
    expect(confirmacao.body.tipoDivergencia).toBe("QUANTIDADE_DIVERGENTE");

    const ordem = await prisma.pedidoCompra.findUniqueOrThrow({
      where: { id: item.pedidoCompraId }
    });
    expect(ordem.status).toBe("PARTIALLY_RECEIVED_MIAMI");
  });

  it("registra item danificado", async () => {
    const { app, d, h } = await session();
    const item = await prisma.pedidoCompraItem.findFirstOrThrow({
      where: { lojaId: d.id }
    });

    const confirmacao = await request(app)
      .post("/logistics/miami-confirmations")
      .set(h(d.id))
      .send({
        pedidoCompraItemId: item.id,
        quantidadeRecebida: item.quantidade,
        recebidoEm: new Date().toISOString(),
        observacao: "Embalagem danificada",
        tipoDivergencia: "DANIFICADO"
      });

    expect(confirmacao.status).toBe(200);
    expect(confirmacao.body.tipoDivergencia).toBe("DANIFICADO");
  });

  it("bloqueia acesso cruzado entre lojas", async () => {
    const { app, d, g, h } = await session();
    const item = await prisma.pedidoCompraItem.findFirstOrThrow({
      where: { lojaId: d.id }
    });

    const tentativa = await request(app)
      .post("/logistics/miami-confirmations")
      .set(h(g.id))
      .send({
        pedidoCompraItemId: item.id,
        quantidadeRecebida: 1,
        recebidoEm: new Date().toISOString(),
        tipoDivergencia: "CORRETO"
      });

    expect(tentativa.status).toBe(409);
  });

  it("não cria entrada de estoque definitivo em Miami", async () => {
    const { app, d, h } = await session();
    const item = await prisma.pedidoCompraItem.findFirstOrThrow({
      where: { lojaId: d.id }
    });
    const produtoId = item.produtoId;

    const estoqueAntes = await prisma.estoque.findFirst({
      where: { lojaId: d.id, produtoId }
    });

    await request(app)
      .post("/logistics/miami-confirmations")
      .set(h(d.id))
      .send({
        pedidoCompraItemId: item.id,
        quantidadeRecebida: item.quantidade,
        recebidoEm: new Date().toISOString(),
        tipoDivergencia: "CORRETO"
      });

    const estoqueDepois = await prisma.estoque.findFirst({
      where: { lojaId: d.id, produtoId }
    });

    expect(estoqueAntes?.quantidadeFisica).toBe(estoqueDepois?.quantidadeFisica);
  });

  it("detecta atraso (recebimento > 24h após data)", async () => {
    const { app, d, h } = await session();
    const item = await prisma.pedidoCompraItem.findFirstOrThrow({
      where: { lojaId: d.id }
    });

    const dataAtrasada = new Date(Date.now() - 90000000);

    const confirmacao = await request(app)
      .post("/logistics/miami-confirmations")
      .set(h(d.id))
      .send({
        pedidoCompraItemId: item.id,
        quantidadeRecebida: item.quantidade,
        recebidoEm: dataAtrasada.toISOString(),
        tipoDivergencia: "CORRETO"
      });

    expect(confirmacao.status).toBe(200);
    expect(confirmacao.body.atraso).toBe(true);
  });
});
