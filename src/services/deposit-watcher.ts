import axios from 'axios';
import { JsonRpcProvider, Contract, formatUnits } from 'ethers';
import { PrismaClient } from '@prisma/client';

const BSC_RPC_URL = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';
const BSC_USDT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955'; // USDT on BSC

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

export async function checkTonDepositsForUser(
  prisma: PrismaClient,
  userId: string,
  tonAddress: string
): Promise<number> {
  if (!tonAddress) return 0;

  try {
    const url = `https://toncenter.com/api/v2/getTransactions?address=${encodeURIComponent(
      tonAddress
    )}&limit=10&archival=false`;

    const res = await axios.get(url, { timeout: 8000 });
    if (!res.data || !res.data.ok || !Array.isArray(res.data.result)) {
      return 0;
    }

    let creditedCount = 0;

    for (const tx of res.data.result) {
      const inMsg = tx.in_msg;
      if (!inMsg) continue;

      const valueNano = Number(inMsg.value || 0);
      if (valueNano <= 0) continue; // No value transferred

      const amountTon = valueNano / 1e9;
      const txHash = tx.transaction_id?.hash;
      if (!txHash) continue;

      // Check if this transaction has already been processed
      const existing = await prisma.transaction.findUnique({
        where: { externalTxId: txHash },
      });

      if (existing) continue;

      // Upsert user's TON wallet and credit balance
      const wallet = await prisma.wallet.upsert({
        where: {
          userId_currency: {
            userId: userId,
            currency: 'TON',
          },
        },
        update: {
          balance: { increment: amountTon },
        },
        create: {
          userId: userId,
          currency: 'TON',
          address: tonAddress,
          balance: amountTon,
        },
      });

      // Record transaction
      await prisma.transaction.create({
        data: {
          walletId: wallet.id,
          amount: amountTon,
          type: 'DEPOSIT',
          status: 'COMPLETED',
          assetSymbol: 'TON',
          externalTxId: txHash,
        },
      });

      creditedCount++;
      console.log(`✅ Automatically credited ${amountTon} TON to user ${userId} (Tx: ${txHash})`);
    }

    return creditedCount;
  } catch (error: any) {
    console.error('Error checking TON deposits:', error.message);
    return 0;
  }
}

export async function checkBscDepositsForUser(
  prisma: PrismaClient,
  userId: string,
  bep20Address: string
): Promise<number> {
  if (!bep20Address) return 0;

  try {
    const provider = new JsonRpcProvider(BSC_RPC_URL);
    const usdtContract = new Contract(BSC_USDT_ADDRESS, ERC20_ABI, provider);

    // Read on-chain USDT balance
    const rawBalance = await usdtContract.balanceOf(bep20Address);
    const onChainUsdt = parseFloat(formatUnits(rawBalance, 18));

    if (onChainUsdt <= 0) return 0;

    // Check user's current credited USDT wallet balance in database
    const wallet = await prisma.wallet.findUnique({
      where: {
        userId_currency: {
          userId: userId,
          currency: 'USDT',
        },
      },
    });

    const currentCredited = wallet ? parseFloat(wallet.balance.toString()) : 0;

    // If on-chain balance is higher than what has been credited so far
    if (onChainUsdt > currentCredited) {
      const difference = onChainUsdt - currentCredited;
      const syntheticTxId = `bsc_usdt_sync_${bep20Address.toLowerCase()}_${Date.now()}`;

      const updatedWallet = await prisma.wallet.upsert({
        where: {
          userId_currency: {
            userId: userId,
            currency: 'USDT',
          },
        },
        update: {
          balance: onChainUsdt,
        },
        create: {
          userId: userId,
          currency: 'USDT',
          address: bep20Address,
          balance: onChainUsdt,
        },
      });

      await prisma.transaction.create({
        data: {
          walletId: updatedWallet.id,
          amount: difference,
          type: 'DEPOSIT',
          status: 'COMPLETED',
          assetSymbol: 'USDT',
          externalTxId: syntheticTxId,
        },
      });

      console.log(
        `✅ Automatically credited ${difference} USDT (Total: ${onChainUsdt}) to user ${userId}`
      );
      return 1;
    }

    return 0;
  } catch (error: any) {
    console.error('Error checking BSC USDT deposits:', error.message);
    return 0;
  }
}

export async function syncUserDeposits(
  prisma: PrismaClient,
  userId: string,
  tonAddress?: string | null,
  bep20Address?: string | null
): Promise<{ tonCredited: number; bep20Credited: number }> {
  let tonCredited = 0;
  let bep20Credited = 0;

  if (tonAddress) {
    tonCredited = await checkTonDepositsForUser(prisma, userId, tonAddress);
  }

  if (bep20Address) {
    bep20Credited = await checkBscDepositsForUser(prisma, userId, bep20Address);
  }

  return { tonCredited, bep20Credited };
}

export default {
  checkTonDepositsForUser,
  checkBscDepositsForUser,
  syncUserDeposits,
};
