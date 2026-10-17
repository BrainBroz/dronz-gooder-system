-- Liga candidatos e compras existentes pela identidade persistente, sem inferir aprovação.
UPDATE "BuyerPurchaseCandidate" candidate
SET "compraImportadaId" = purchase."id",
    "version" = candidate."version" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "CompraImportada" purchase
WHERE candidate."compraImportadaId" IS NULL
  AND purchase."contaExternaId" = candidate."contaExternaId"
  AND purchase."externalOrderIdNormalizado" = candidate."externalOrderIdNormalized"
  AND purchase."plataforma"::text = candidate."provider"::text;
