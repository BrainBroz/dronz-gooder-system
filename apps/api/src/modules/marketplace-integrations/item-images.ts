import { prisma } from "../../lib/prisma";
import type { MarketplaceAdapter, MarketplaceConnectionContext, NormalizedMarketplaceOrder } from "./marketplace-integrations.types";

/** Busca no marketplace a foto dos anúncios que ainda não temos; nunca falha a sincronização. */
export async function ensureItemImages(adapter: MarketplaceAdapter, connection: MarketplaceConnectionContext, orders: NormalizedMarketplaceOrder[]) {
  if (!adapter.fetchItemImages) return;
  const ids = [...new Set(orders.flatMap((order) => order.items.map((item) => item.offerId)).filter((id): id is string => Boolean(id)))];
  if (!ids.length) return;
  try {
    const known = new Set(
      (await prisma.imagemAnuncioExterno.findMany({ where: { provider: adapter.provider, anuncioId: { in: ids } }, select: { anuncioId: true } })).map((row) => row.anuncioId)
    );
    const missing = ids.filter((id) => !known.has(id));
    if (!missing.length) return;
    const found = await adapter.fetchItemImages(connection, missing);
    await prisma.imagemAnuncioExterno.createMany({
      data: Object.entries(found).map(([anuncioId, url]) => ({ provider: adapter.provider, anuncioId, url })),
      skipDuplicates: true
    });
  } catch {
    // foto é complemento: a compra segue sem ela
  }
}

export async function itemImages(provider: "AMAZON" | "EBAY", ids: string[]) {
  const rows = ids.length ? await prisma.imagemAnuncioExterno.findMany({ where: { provider, anuncioId: { in: ids } } }) : [];
  return new Map(rows.map((row) => [row.anuncioId, row.url]));
}
