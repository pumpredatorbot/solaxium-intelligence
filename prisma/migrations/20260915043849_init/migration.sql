-- CreateEnum
CREATE TYPE "SimulationStatus" AS ENUM ('CREATED', 'RUNNING', 'PAUSED', 'STOPPED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('ALIVE', 'DEAD');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('CREATE_PRODUCT', 'SELL_PRODUCT', 'OFFER_SERVICE', 'MARKETING', 'RESEARCH', 'REST', 'INVEST_IN_GROWTH', 'SAVE');

-- CreateEnum
CREATE TYPE "ActionOutcome" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILURE');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INITIAL_CAPITAL', 'REVENUE', 'EXPENSE', 'CLONE_BONUS', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('SIMULATION_CREATED', 'SIMULATION_STARTED', 'SIMULATION_PAUSED', 'SIMULATION_STOPPED', 'SIMULATION_COMPLETED', 'GENERATION_STARTED', 'GENERATION_ENDED', 'AGENT_BORN', 'AGENT_ACTION', 'AGENT_REVENUE', 'AGENT_EXPENSE', 'AGENT_DEAD', 'CLONE_CREATED');

-- CreateEnum
CREATE TYPE "MemoryKind" AS ENUM ('STRATEGY', 'SUCCESS', 'FAILURE', 'INSIGHT', 'MILESTONE', 'SUMMARY');

-- CreateTable
CREATE TABLE "Simulation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "seed" TEXT NOT NULL,
    "status" "SimulationStatus" NOT NULL DEFAULT 'CREATED',
    "rngCursor" INTEGER NOT NULL DEFAULT 0,
    "cycle" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Simulation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "simulationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "parentId" TEXT,
    "status" "AgentStatus" NOT NULL DEFAULT 'ALIVE',
    "capitalLamports" BIGINT NOT NULL,
    "startingCapitalLamports" BIGINT NOT NULL,
    "peakCapitalLamports" BIGINT NOT NULL,
    "totalRevenueLamports" BIGINT NOT NULL DEFAULT 0,
    "totalExpensesLamports" BIGINT NOT NULL DEFAULT 0,
    "cycles" INTEGER NOT NULL DEFAULT 0,
    "bornAtCycle" INTEGER NOT NULL DEFAULT 0,
    "diedAtCycle" INTEGER,
    "clonesCreated" INTEGER NOT NULL DEFAULT 0,
    "strategy" TEXT NOT NULL DEFAULT 'BALANCED',
    "strategyNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diedAt" TIMESTAMP(3),

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTrait" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "AgentTrait_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMemory" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "kind" "MemoryKind" NOT NULL,
    "content" TEXT NOT NULL,
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "cycle" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentAction" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "simulationId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "type" "ActionType" NOT NULL,
    "outcome" "ActionOutcome" NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "costLamports" BIGINT NOT NULL,
    "revenueLamports" BIGINT NOT NULL,
    "netLamports" BIGINT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "reasoning" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'demo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "simulationId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amountLamports" BIGINT NOT NULL,
    "balanceBeforeLamports" BIGINT NOT NULL,
    "balanceAfterLamports" BIGINT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clone" (
    "id" TEXT NOT NULL,
    "simulationId" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "mutations" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Clone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationEvent" (
    "seq" SERIAL NOT NULL,
    "simulationId" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "cycle" INTEGER NOT NULL,
    "agentId" TEXT,
    "agentCode" TEXT,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulationEvent_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "Generation" (
    "id" TEXT NOT NULL,
    "simulationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "agentCount" INTEGER NOT NULL DEFAULT 0,
    "aliveCount" INTEGER NOT NULL DEFAULT 0,
    "deadCount" INTEGER NOT NULL DEFAULT 0,
    "totalRevenueLamports" BIGINT NOT NULL DEFAULT 0,
    "totalExpensesLamports" BIGINT NOT NULL DEFAULT 0,
    "totalCapitalLamports" BIGINT NOT NULL DEFAULT 0,
    "averageCapitalLamports" BIGINT NOT NULL DEFAULT 0,
    "averageProfitLamports" BIGINT NOT NULL DEFAULT 0,
    "bestAgentId" TEXT,
    "bestAgentCode" TEXT,
    "startedAtCycle" INTEGER NOT NULL DEFAULT 0,
    "endedAtCycle" INTEGER,

    CONSTRAINT "Generation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentWallet" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'simulation',
    "publicAddress" TEXT NOT NULL,
    "network" TEXT NOT NULL DEFAULT 'simulation',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentWallet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Simulation_status_idx" ON "Simulation"("status");

-- CreateIndex
CREATE INDEX "Simulation_createdAt_idx" ON "Simulation"("createdAt");

-- CreateIndex
CREATE INDEX "Agent_simulationId_status_idx" ON "Agent"("simulationId", "status");

-- CreateIndex
CREATE INDEX "Agent_simulationId_generation_idx" ON "Agent"("simulationId", "generation");

-- CreateIndex
CREATE INDEX "Agent_parentId_idx" ON "Agent"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_simulationId_code_key" ON "Agent"("simulationId", "code");

-- CreateIndex
CREATE INDEX "AgentTrait_agentId_idx" ON "AgentTrait"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTrait_agentId_key_key" ON "AgentTrait"("agentId", "key");

-- CreateIndex
CREATE INDEX "AgentMemory_agentId_cycle_idx" ON "AgentMemory"("agentId", "cycle");

-- CreateIndex
CREATE INDEX "AgentMemory_agentId_kind_idx" ON "AgentMemory"("agentId", "kind");

-- CreateIndex
CREATE INDEX "AgentAction_agentId_cycle_idx" ON "AgentAction"("agentId", "cycle");

-- CreateIndex
CREATE INDEX "AgentAction_simulationId_cycle_idx" ON "AgentAction"("simulationId", "cycle");

-- CreateIndex
CREATE INDEX "AgentAction_simulationId_type_idx" ON "AgentAction"("simulationId", "type");

-- CreateIndex
CREATE INDEX "Transaction_agentId_cycle_idx" ON "Transaction"("agentId", "cycle");

-- CreateIndex
CREATE INDEX "Transaction_simulationId_createdAt_idx" ON "Transaction"("simulationId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_type_idx" ON "Transaction"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Clone_childId_key" ON "Clone"("childId");

-- CreateIndex
CREATE INDEX "Clone_simulationId_idx" ON "Clone"("simulationId");

-- CreateIndex
CREATE INDEX "Clone_parentId_idx" ON "Clone"("parentId");

-- CreateIndex
CREATE INDEX "SimulationEvent_simulationId_seq_idx" ON "SimulationEvent"("simulationId", "seq");

-- CreateIndex
CREATE INDEX "SimulationEvent_simulationId_type_idx" ON "SimulationEvent"("simulationId", "type");

-- CreateIndex
CREATE INDEX "SimulationEvent_agentId_idx" ON "SimulationEvent"("agentId");

-- CreateIndex
CREATE INDEX "Generation_simulationId_idx" ON "Generation"("simulationId");

-- CreateIndex
CREATE UNIQUE INDEX "Generation_simulationId_number_key" ON "Generation"("simulationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "AgentWallet_agentId_key" ON "AgentWallet"("agentId");

-- CreateIndex
CREATE INDEX "AgentWallet_publicAddress_idx" ON "AgentWallet"("publicAddress");

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTrait" ADD CONSTRAINT "AgentTrait_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clone" ADD CONSTRAINT "Clone_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clone" ADD CONSTRAINT "Clone_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clone" ADD CONSTRAINT "Clone_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationEvent" ADD CONSTRAINT "SimulationEvent_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentWallet" ADD CONSTRAINT "AgentWallet_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
