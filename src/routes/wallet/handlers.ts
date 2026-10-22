import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { deriveUserWallets } from '../../services/wallet';
import { syncUserDeposits } from '../../services/deposit-watcher';
import { ErrorResponseSchema } from '../../swagger';

interface WalletPluginOptions extends FastifyPluginOptions {
  prisma: PrismaClient;
}

export async function walletRoutes(fastify: FastifyInstance, options: WalletPluginOptions) {
  const { prisma } = options;

  // Get current user's wallets & deposit addresses
  fastify.get(
    '/me',
    {
      schema: {
        tags: ['Wallet'],
        summary: 'Get current user wallets, deposit addresses, and trigger deposit sync',
        description:
          'Retrieves deterministic HD deposit addresses (TON & BEP-20) and balances for the authenticated Telegram user.',
        security: [{ telegramAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  walletIndex: { type: 'integer' },
                  tonDepositAddress: { type: 'string' },
                  bep20DepositAddress: { type: 'string' },
                  wallets: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        currency: { type: 'string' },
                        address: { type: 'string', nullable: true },
                        balance: { type: 'string' },
                        lockedBalance: { type: 'string' },
                      },
                    },
                  },
                },
              },
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
        let user = await prisma.user.findUnique({
          where: { telegramId: BigInt(tgUser.id) },
          include: { wallets: true },
        });

        if (!user) {
          return reply.status(404).send({ error: 'User not found. Please visit /profile first.' });
        }

        // If addresses are not yet assigned, generate them now using deterministic HD derivation
        if (!user.tonDepositAddress || !user.bep20DepositAddress) {
          const derived = deriveUserWallets(user.walletIndex);
          user = await prisma.user.update({
            where: { id: user.id },
            data: {
              tonDepositAddress: user.tonDepositAddress || derived.tonAddress,
              bep20DepositAddress: user.bep20DepositAddress || derived.bep20Address,
            },
            include: { wallets: true },
          });

          // Ensure default Wallets (TON and USDT) exist
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

        // Auto-check for on-chain deposits
        await syncUserDeposits(prisma, user.id, user.tonDepositAddress, user.bep20DepositAddress);

        // Reload wallets
        const wallets = await prisma.wallet.findMany({
          where: { userId: user.id },
        });

        return {
          success: true,
          data: {
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
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Failed to retrieve wallets' });
      }
    }
  );

  // Explicitly trigger on-chain deposit sync
  fastify.post(
    '/sync',
    {
      schema: {
        tags: ['Wallet'],
        summary: 'Sync on-chain deposits',
        description: 'Queries blockchain explorers/nodes for incoming TON and BEP-20 transfers to user deposit addresses.',
        security: [{ telegramAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              syncResult: { type: 'object', additionalProperties: true },
              wallets: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    currency: { type: 'string' },
                    balance: { type: 'string' },
                  },
                },
              },
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
        const user = await prisma.user.findUnique({
          where: { telegramId: BigInt(tgUser.id) },
        });

        if (!user) {
          return reply.status(404).send({ error: 'User not found' });
        }

        const syncResult = await syncUserDeposits(
          prisma,
          user.id,
          user.tonDepositAddress,
          user.bep20DepositAddress
        );

        const wallets = await prisma.wallet.findMany({
          where: { userId: user.id },
        });

        return {
          success: true,
          message: 'On-chain deposit sync completed',
          syncResult,
          wallets: wallets.map((w) => ({
            currency: w.currency,
            balance: w.balance.toString(),
          })),
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Failed to sync on-chain deposits' });
      }
    }
  );

  // Explicitly trigger address generation/sync
  fastify.post(
    '/generate',
    {
      schema: {
        tags: ['Wallet'],
        summary: 'Force generate / re-derive HD deposit addresses',
        description: 'Derives deterministic TON & BEP-20 addresses for current user from master HD seed and stores in database.',
        security: [{ telegramAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  walletIndex: { type: 'integer' },
                  tonDepositAddress: { type: 'string' },
                  bep20DepositAddress: { type: 'string' },
                },
              },
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
        const user = await prisma.user.findUnique({
          where: { telegramId: BigInt(tgUser.id) },
        });

        if (!user) {
          return reply.status(404).send({ error: 'User not found' });
        }

        const derived = deriveUserWallets(user.walletIndex);

        const updatedUser = await prisma.user.update({
          where: { id: user.id },
          data: {
            tonDepositAddress: derived.tonAddress,
            bep20DepositAddress: derived.bep20Address,
          },
        });

        await prisma.wallet.upsert({
          where: { userId_currency: { userId: user.id, currency: 'TON' } },
          update: { address: derived.tonAddress },
          create: { userId: user.id, currency: 'TON', address: derived.tonAddress, balance: 0 },
        });

        await prisma.wallet.upsert({
          where: { userId_currency: { userId: user.id, currency: 'USDT' } },
          update: { address: derived.bep20Address },
          create: { userId: user.id, currency: 'USDT', address: derived.bep20Address, balance: 0 },
        });

        return {
          success: true,
          data: {
            walletIndex: updatedUser.walletIndex,
            tonDepositAddress: updatedUser.tonDepositAddress,
            bep20DepositAddress: updatedUser.bep20DepositAddress,
          },
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Failed to generate wallets' });
      }
    }
  );
}

export default walletRoutes;
