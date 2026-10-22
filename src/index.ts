import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { validateTelegramInitData } from './auth';
import { walletRoutes } from './routes/wallet/handlers';
import { deriveUserWallets } from './services/wallet';

dotenv.config();

const fastify = Fastify({ logger: true });

export const prisma = new PrismaClient({
  log: ['error', 'warn'],
});

async function checkDbConnection() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ Database connection established successfully');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
  }
}

fastify.register(cors, {
  origin: '*', // In production, restrict this to your Mini App domain
});

const BOT_TOKEN = process.env.BOT_TOKEN || '';

// Auth Middleware
fastify.addHook('preHandler', async (request, reply) => {
  if (request.url === '/health' || request.url === '/webhooks/tatum') return;

  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('tma ')) {
    return reply.status(401).send({ error: 'Missing or invalid authorization header' });
  }

  const initData = authHeader.replace('tma ', '');
  if (BOT_TOKEN && !validateTelegramInitData(initData, BOT_TOKEN)) {
    return reply.status(401).send({ error: 'Invalid Telegram initData' });
  }

  const urlParams = new URLSearchParams(initData);
  const userJson = urlParams.get('user');
  if (userJson) {
    try {
      (request as any).user = JSON.parse(userJson);
    } catch {
      return reply.status(400).send({ error: 'Failed to parse user from initData' });
    }
  }
});

// Health check with deployment version
fastify.get('/health', async () => {
  return {
    status: 'ok',
    version: '2.0.0-hd-wallets',
    timestamp: new Date().toISOString(),
  };
});

// Register Wallet Routes
fastify.register(walletRoutes, { prefix: '/wallet', prisma });

// Tatum Webhook for deposits
fastify.post('/webhooks/tatum', async (request, reply) => {
  const payload = request.body as any;
  const data = payload?.data || payload;

  if (!data || !data.txId || !data.amount) {
    return reply.status(400).send({ error: 'Invalid Tatum webhook payload' });
  }

  const { amount, currency, txId, address } = data;

  try {
    let user = null;
    if (address) {
      user = await prisma.user.findFirst({
        where: {
          OR: [
            { tonDepositAddress: address },
            { bep20DepositAddress: address },
          ],
        },
      });
    }

    if (!user) {
      fastify.log.warn(`Deposit received for unknown address: ${address}`);
      return reply.status(404).send({ error: 'User for this deposit address not found' });
    }

    const standardCurrency = (currency || 'USDT').toUpperCase();

    const wallet = await prisma.wallet.upsert({
      where: {
        userId_currency: {
          userId: user.id,
          currency: standardCurrency,
        },
      },
      update: {
        balance: {
          increment: parseFloat(amount),
        },
      },
      create: {
        userId: user.id,
        currency: standardCurrency,
        balance: parseFloat(amount),
      },
    });

    await prisma.transaction.create({
      data: {
        walletId: wallet.id,
        amount: parseFloat(amount),
        type: 'DEPOSIT',
        status: 'COMPLETED',
        assetSymbol: standardCurrency,
        externalTxId: txId,
      },
    });

    return { success: true, message: 'Balance updated successfully' };
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Internal Server Error' });
  }
});

// Manual deposit notification from user
fastify.post('/deposits', async (request, reply) => {
  const tgUser = (request as any).user;
  if (!tgUser) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  const { amount, currency, txId } = request.body as any;

  if (!amount || !currency || !txId) {
    return reply.status(400).send({ error: 'Amount, currency, and txId are required' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { telegramId: BigInt(tgUser.id) },
    });

    if (!user) {
      return reply.status(404).send({ error: 'User profile not found. Please load profile first.' });
    }

    const deposit = await prisma.depositRequest.create({
      data: {
        userId: user.id,
        amount: parseFloat(amount),
        currency: currency.toUpperCase(),
        txId: txId.trim(),
      },
    });

    return {
      success: true,
      message: 'Deposit request submitted successfully!',
      depositId: deposit.id,
    };
  } catch (error: any) {
    if (error.code === 'P2002') {
      return reply.status(400).send({ error: 'This transaction ID has already been submitted.' });
    }
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Internal Server Error' });
  }
});

// Profile route with auto HD wallet derivation
fastify.get('/profile', async (request, reply) => {
  const tgUser = (request as any).user;
  if (!tgUser) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  try {
    let user = await prisma.user.upsert({
      where: { telegramId: BigInt(tgUser.id) },
      update: {
        username: tgUser.username || null,
        firstName: tgUser.first_name || null,
        lastName: tgUser.last_name || null,
        languageCode: tgUser.language_code || null,
      },
      create: {
        telegramId: BigInt(tgUser.id),
        username: tgUser.username || null,
        firstName: tgUser.first_name || null,
        lastName: tgUser.last_name || null,
        languageCode: tgUser.language_code || null,
      },
      include: {
        wallets: true,
      },
    });

    // Auto-derive HD deposit addresses if not yet populated
    if (!user.tonDepositAddress || !user.bep20DepositAddress) {
      const walletIdx = user.walletIndex || 1;
      const derived = deriveUserWallets(walletIdx);

      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          tonDepositAddress: user.tonDepositAddress || derived.tonAddress,
          bep20DepositAddress: user.bep20DepositAddress || derived.bep20Address,
        },
        include: {
          wallets: true,
        },
      });

      // Ensure TON and USDT default wallets exist
      await prisma.wallet.upsert({
        where: { userId_currency: { userId: user.id, currency: 'TON' } },
        update: { address: user.tonDepositAddress },
        create: { userId: user.id, currency: 'TON', address: user.tonDepositAddress, balance: 0 },
      });

      await prisma.wallet.upsert({
        where: { userId_currency: { userId: user.id, currency: 'USDT' } },
        update: { address: user.bep20DepositAddress },
        create: { userId: user.id, currency: 'USDT', address: user.bep20DepositAddress, balance: 0 },
      });
    }

    const wallets = await prisma.wallet.findMany({
      where: { userId: user.id },
    });

    return {
      user: {
        id: user.id,
        telegramId: user.telegramId.toString(),
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        first_name: user.firstName,
        last_name: user.lastName,
        languageCode: user.languageCode,
        walletIndex: user.walletIndex,
        tonDepositAddress: user.tonDepositAddress,
        bep20DepositAddress: user.bep20DepositAddress,
        wallets: wallets.map((w) => ({
          id: w.id,
          currency: w.currency,
          address: w.address,
          balance: w.balance.toString(),
          lockedBalance: w.lockedBalance.toString(),
        })),
      },
      message: 'Welcome to the Trading App!',
    };
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({
      error: 'Internal Server Error',
      details: error instanceof Error ? error.message : 'Unknown database error',
    });
  }
});

const start = async () => {
  try {
    await checkDbConnection();
    const port = Number(process.env.PORT) || 3001;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 Server listening on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
