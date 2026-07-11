/**
 * CHECKPOINT_MIAMI serializer (§11 ARQUITETURA_OPERACIONAL_V2).
 *
 * Removes 15+ monetary field patterns recursively from entire object graph.
 * Used for location/logistics teams who must never see pricing data.
 */

const MONETARY_PATTERNS = [
  "preco",
  "custo",
  "desconto",
  "frete",
  "imposto",
  "pagamento",
  "cambio",
  "cotacao",
  "markup",
  "margem",
  "valor",
  "total",
  "subtotal",
  "iof",
  "taxa",
  "moeda"
];

export function toMiamiView(obj: any): any {
  if (obj === null || obj === undefined) return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => toMiamiView(item));
  }

  if (typeof obj !== "object") {
    return obj;
  }

  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    const keyLower = key.toLowerCase();
    const isMonetary = MONETARY_PATTERNS.some((pattern) =>
      keyLower.includes(pattern)
    );

    if (!isMonetary) {
      result[key] = toMiamiView(value);
    }
  }

  return result;
}
