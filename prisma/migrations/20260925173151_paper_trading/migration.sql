-- CreateEnum
CREATE TYPE "MarketSource" AS ENUM ('FIXTURE', 'RECORDED', 'LIVE');

-- CreateEnum
CREATE TYPE "SimulationMode" AS ENUM ('ECONOMIC', 'TRADING');

-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PositionExit" AS ENUM ('TP1', 'TP2', 'STOP', 'TIMEOUT');

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "avgHoldSteps" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "fitness" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
ADD COLUMN     "maxDrawdown" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "rawFitness" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
ADD COLUMN     "stops" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "timeouts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tp1Hits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tp2Hits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tradesClosed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "wins" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Simulation" ADD COLUMN     "datasetId" TEXT,
ADD COLUMN     "mode" "SimulationMode" NOT NULL DEFAULT 'ECONOMIC';

-- CreateTable
CREATE TABLE "MarketDataset" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "source" "MarketSource" NOT NULL,
    "seed" TEXT,
    "steps" INTEGER NOT NULL,
    "stepMs" INTEGER NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketDataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Token" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "mint" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "launchStep" INTEGER NOT NULL,
    "launchedAt" TIMESTAMP(3) NOT NULL,
    "initialMcapLamports" BIGINT NOT NULL,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "simulationId" TEXT NOT NULL,
    "tokenId" TEXT,
    "mint" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "status" "PositionStatus" NOT NULL DEFAULT 'OPEN',
    "entryStep" INTEGER NOT NULL,
    "quotedEntryLamports" BIGINT NOT NULL,
    "entryPriceLamports" BIGINT NOT NULL,
    "sizeLamports" BIGINT NOT NULL,
    "takeProfitMultiple" DOUBLE PRECISION NOT NULL,
    "stopMultiple" DOUBLE PRECISION NOT NULL,
    "maxHoldSteps" INTEGER NOT NULL,
    "exitStep" INTEGER,
    "exitReason" "PositionExit",
    "exitPriceLamports" BIGINT,
    "proceedsLamports" BIGINT,
    "pnlLamports" BIGINT,
    "returnPct" DOUBLE PRECISION,
    "holdSteps" INTEGER,
    "feesLamports" BIGINT NOT NULL DEFAULT 0,
    "slippageLamports" BIGINT NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketDataset_key_key" ON "MarketDataset"("key");

-- CreateIndex
CREATE INDEX "MarketDataset_source_idx" ON "MarketDataset"("source");

-- CreateIndex
CREATE INDEX "Token_datasetId_launchStep_idx" ON "Token"("datasetId", "launchStep");

-- CreateIndex
CREATE UNIQUE INDEX "Token_datasetId_mint_key" ON "Token"("datasetId", "mint");

-- CreateIndex
CREATE INDEX "Position_agentId_status_idx" ON "Position"("agentId", "status");

-- CreateIndex
CREATE INDEX "Position_simulationId_entryStep_idx" ON "Position"("simulationId", "entryStep");

-- CreateIndex
CREATE INDEX "Position_simulationId_status_idx" ON "Position"("simulationId", "status");

-- CreateIndex
CREATE INDEX "Position_mint_idx" ON "Position"("mint");

-- AddForeignKey
ALTER TABLE "Simulation" ADD CONSTRAINT "Simulation_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MarketDataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE SET NULL ON UPDATE CASCADE;
