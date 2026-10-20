-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TRADE_BUY', 'TRADE_SELL', 'REFERRAL_BONUS');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "languageCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "referrerId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "balance" DECIMAL(20,8) NOT NULL DEFAULT 0.00,
    "lockedBalance" DECIMAL(20,8) NOT NULL DEFAULT 0.00,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "fee" DECIMAL(20,8) NOT NULL DEFAULT 0.00,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "assetSymbol" TEXT,
    "executionPrice" DECIMAL(20,8),
    "externalTxId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_currency_key" ON "Wallet"("userId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_externalTxId_key" ON "Transaction"("externalTxId");

-- CreateIndex
CREATE INDEX "Transaction_walletId_idx" ON "Transaction"("walletId");

-- CreateIndex
CREATE INDEX "Transaction_status_idx" ON "Transaction"("status");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
