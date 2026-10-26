import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { validateTelegramInitData } from './auth';
import { walletRoutes } from './routes/wallet/handlers';
import { tradeRoutes } from './routes/trade/handlers';
import { deriveUserWallets } from './services/wallet';
import {
  swaggerOptions,
  swaggerUiOptions,
  ErrorResponseSchema,
  UserProfileSchema,
} from './swagger';

dotenv.config();

const fastify = Fastify({
  logger: true,
  ajv: {
    customOptions: {
      strict: false,
    },
  },
});

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

const BOT_TOKEN = process.env.BOT_TOKEN || '';

// Auth Middleware
fastify.addHook('preHandler', async (request, reply) => {
  const url = request.url;
  if (
    url === '/health' ||
    url === '/webhooks/tatum' ||
    url.startsWith('/docs') ||
    url.startsWith('/documentation') ||
    url === '/trade/rates' ||
    url === '/trade/platform-account'
  ) {
    return;
  }

  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('tma ')) {
    return reply.status(401).send({
      error: 'Missing or invalid authorization header',
      hint: 'In Swagger UI, click Authorize and enter: tma test_user=123456789 (or paste your Telegram initData prefixed with "tma ")',
    });
  }

  const initData = authHeader.replace('tma ', '').trim();

  // Test mode for Swagger / local testing: tma test_user=123456789 or tma mock_user=123456789
  if (initData.startsWith('test_user=') || initData.startsWith('mock_user=')) {
    const userIdVal = initData.split('=')[1] || '123456789';
    const userId = Number(userIdVal) || 123456789;
    (request as any).user = {
      id: userId,
      first_name: 'SwaggerTest',
      last_name: 'User',
      username: `tester_${userId}`,
      language_code: 'en',
    };
    return;
  }

  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get('hash');

  // If testing with raw user JSON without hash
  if (!hash) {
    const rawUser = urlParams.get('user') || (initData.startsWith('{') ? initData : null);
    if (rawUser) {
      try {
        (request as any).user = JSON.parse(rawUser);
        return;
      } catch {
        // proceed to hash validation
      }
    }
  }

  // Real Telegram initData validation
  if (BOT_TOKEN && !validateTelegramInitData(initData, BOT_TOKEN)) {
    return reply.status(401).send({
      error: 'Invalid Telegram initData signature',
      hint: 'Signature validation failed with BOT_TOKEN. For Swagger testing, you can use: tma test_user=123456789',
    });
  }

  const userJson = urlParams.get('user');
  if (userJson) {
    try {
      (request as any).user = JSON.parse(userJson);
    } catch {
      return reply.status(400).send({ error: 'Failed to parse user from initData' });
    }
  } else {
    return reply.status(400).send({ error: 'No user data found in initData' });
  }
});

const start = async () => {
  try {
    await checkDbConnection();

    // Register Swagger & Swagger UI plugins
    await fastify.register(fastifySwagger, swaggerOptions);
    await fastify.register(fastifySwaggerUi, swaggerUiOptions);

    await fastify.register(cors, {
      origin: '*',
    });

    // Health check with deployment version
    fastify.get(
      '/health',
      {
        schema: {
          tags: ['System'],
          summary: 'Service health check',
          description: 'Checks backend status, deployment version, and current UTC timestamp.',
          response: {
            200: {
              type: 'object',
              properties: {
                status: { type: 'string', example: 'ok' },
                version: { type: 'string', example: '2.0.0-hd-wallets' },
                timestamp: { type: 'string' },
              },
            },
            500: ErrorResponseSchema,
          },
        },
      },
      async () => {
        return {
          status: 'ok',
          version: '2.0.0-hd-wallets',
          timestamp: new Date().toISOString(),
        };
      }
    );

    // Profile route with auto HD wallet derivation
    fastify.get(
      '/profile',
      {
        schema: {
          tags: ['User & Profile'],
          summary: 'Get or initialize user profile & auto-generate HD addresses',
          description:
            'Upserts user from Telegram data, derives unique TON & BEP-20 HD deposit addresses if not yet generated, and returns user profile with balances.',
          security: [{ telegramAuth: [] }],
          response: {
            200: {
              type: 'object',
              properties: {
                user: UserProfileSchema,
                message: { type: 'string' },
              },
            },
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            404: ErrorResponseSchema,
            500: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
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
              bankName: user.bankName,
              accountNumber: user.accountNumber,
              accountName: user.accountName,
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
      }
    );

    // Register Wallet Routes
    await fastify.register(walletRoutes, { prefix: '/wallet', prisma });

    // Register Trade & Settings Routes
    await fastify.register(tradeRoutes, { prefix: '/trade', prisma });
    await fastify.register(tradeRoutes, { prefix: '/settings', prisma });

    // Manual deposit notification from user
    fastify.post(
      '/deposits',
      {
        schema: {
          tags: ['Deposits'],
          summary: 'Submit manual deposit confirmation',
          description: 'Allows a user to notify the backend of a manual on-chain transfer with txId.',
          security: [{ telegramAuth: [] }],
          body: {
            type: 'object',
            required: ['amount', 'currency', 'txId'],
            properties: {
              amount: { type: 'number', example: 10 },
              currency: { type: 'string', example: 'USDT' },
              txId: { type: 'string', example: '0x123abc456def... or TON transaction hash' },
            },
          },
          response: {
            200: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                message: { type: 'string' },
                depositId: { type: 'string' },
              },
            },
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            404: ErrorResponseSchema,
            500: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
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
      }
    );

    // Tatum Webhook for deposits
    fastify.post(
      '/webhooks/tatum',
      {
        schema: {
          tags: ['Webhooks'],
          summary: 'Tatum deposit webhook',
          description: 'Webhook receiver for Tatum blockchain transfer notifications.',
          body: {
            type: 'object',
            properties: {
              amount: { type: 'string', example: '50' },
              currency: { type: 'string', example: 'USDT' },
              txId: { type: 'string', example: '0xabc...' },
              address: { type: 'string', example: '0x...' },
            },
          },
          response: {
            200: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                message: { type: 'string' },
              },
            },
            400: ErrorResponseSchema,
            404: ErrorResponseSchema,
            500: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
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
      }
    );

    const port = Number(process.env.PORT) || 3001;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 Server listening on port ${port}`);
    console.log(`📖 Swagger API Documentation available at: http://localhost:${port}/docs`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
