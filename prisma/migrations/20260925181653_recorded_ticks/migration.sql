-- AlterTable
ALTER TABLE "Token" ADD COLUMN     "tickCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tradeCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Tick" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "mint" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "ageMs" INTEGER NOT NULL,
    "priceLamports" BIGINT NOT NULL,
    "mcapLamports" BIGINT NOT NULL,
    "buys" INTEGER NOT NULL,
    "sells" INTEGER NOT NULL,
    "volumeLamports" BIGINT NOT NULL,
    "holders" INTEGER NOT NULL,
    "momentum" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Tick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tick_datasetId_step_idx" ON "Tick"("datasetId", "step");

-- CreateIndex
CREATE UNIQUE INDEX "Tick_datasetId_mint_step_key" ON "Tick"("datasetId", "mint", "step");

-- AddForeignKey
ALTER TABLE "Tick" ADD CONSTRAINT "Tick_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;
