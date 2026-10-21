-- CreateTable
CREATE TABLE "ImagemAnuncioExterno" (
    "id" TEXT NOT NULL,
    "provider" "MarketplaceProvider" NOT NULL,
    "anuncioId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImagemAnuncioExterno_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImagemAnuncioExterno_provider_anuncioId_key" ON "ImagemAnuncioExterno"("provider", "anuncioId");
