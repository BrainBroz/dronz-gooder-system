-- CreateTable
CREATE TABLE "PacoteItem" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "pacoteExternoId" TEXT NOT NULL,
    "pedidoCompraItemId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PacoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PacoteItem_pedidoCompraItemId_idx" ON "PacoteItem"("pedidoCompraItemId");

-- CreateIndex
CREATE UNIQUE INDEX "PacoteItem_pacoteExternoId_pedidoCompraItemId_key" ON "PacoteItem"("pacoteExternoId", "pedidoCompraItemId");

-- AddForeignKey
ALTER TABLE "PacoteItem" ADD CONSTRAINT "PacoteItem_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PacoteItem" ADD CONSTRAINT "PacoteItem_pacoteExternoId_fkey" FOREIGN KEY ("pacoteExternoId") REFERENCES "PacoteExterno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PacoteItem" ADD CONSTRAINT "PacoteItem_pedidoCompraItemId_lojaId_fkey" FOREIGN KEY ("pedidoCompraItemId", "lojaId") REFERENCES "PedidoCompraItem"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "PacoteItem" ADD CONSTRAINT "PacoteItem_quantidade_check" CHECK ("quantidade" > 0);
