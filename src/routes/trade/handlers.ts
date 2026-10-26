import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient, TradeType, TradeOrderStatus, TransactionType, TransactionStatus } from '@prisma/client';
import { getLiveTokenRates } from '../../services/cmc';

interface TradePluginOptions extends FastifyPluginOptions {
  prisma: PrismaClient;
}

export async function tradeRoutes(fastify: FastifyInstance, options: TradePluginOptions) {
  const { prisma } = options;

  // 1. Get Live Token Rates from CoinMarketCap (or fallbacks)
  fastify.get(
    '/rates',
    {
      schema: {
        tags: ['Trade'],
        summary: 'Get live token rates in USD and NGN via CoinMarketCap',
        description: 'Returns real-time prices and NGN equivalents for USDT and TON tokens.',
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const rates = await getLiveTokenRates();
        return reply.send({ success: true, ...rates });
      } catch (error: any) {
        return reply.status(500).send({
          success: false,
          error: 'Failed to fetch rates',
          message: error.message,
        });
      }
    }
  );

  // 2. Get Platform Default Bank Details for Buy flow
  fastify.get(
    '/platform-account',
    {
      schema: {
        tags: ['Trade'],
        summary: 'Get platform bank account details for Buy payment transfers',
        description: 'Returns the designated platform bank account where buyers transfer NGN.',
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({
        success: true,
        account: {
          bankName: process.env.PLATFORM_BANK_NAME || 'Moniepoint MFB',
          accountNumber: process.env.PLATFORM_ACCOUNT_NUMBER || '8203948192',
          accountName: process.env.PLATFORM_ACCOUNT_NAME || 'Ogohmi Trading Platform',
          instructions:
            'Transfer the exact NGN amount to this account. Include your unique Payment Reference in the transfer narration/remark.',
        },
      });
    }
  );

  // 3. Get User's Saved Bank Details (Settings)
  fastify.get(
    '/bank-details',
    {
      schema: {
        tags: ['Settings & Bank'],
        summary: "Get current user's saved bank details",
        security: [{ telegramAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tgUser = (request as any).user;
      if (!tgUser) return reply.status(401).send({ error: 'Unauthorized' });

      const user = await prisma.user.findUnique({
        where: { telegramId: BigInt(tgUser.id) },
        select: {
          id: true,
          bankName: true,
          accountNumber: true,
          accountName: true,
        },
      });

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      return reply.send({
        success: true,
        bankDetails: {
          bankName: user.bankName || '',
          accountNumber: user.accountNumber || '',
          accountName: user.accountName || '',
          isConfigured: !!(user.bankName && user.accountNumber && user.accountName),
        },
      });
    }
  );

  // 4. Save/Update User's Bank Details (Settings)
  fastify.post(
    '/bank-details',
    {
      schema: {
        tags: ['Settings & Bank'],
        summary: "Save or update current user's bank details",
        security: [{ telegramAuth: [] }],
        body: {
          type: 'object',
          required: ['bankName', 'accountNumber', 'accountName'],
          properties: {
            bankName: { type: 'string', minLength: 2 },
            accountNumber: { type: 'string', minLength: 9, maxLength: 12 },
            accountName: { type: 'string', minLength: 2 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tgUser = (request as any).user;
      if (!tgUser) return reply.status(401).send({ error: 'Unauthorized' });

      const { bankName, accountNumber, accountName } = request.body as {
        bankName: string;
        accountNumber: string;
        accountName: string;
      };

      if (!bankName.trim() || !accountNumber.trim() || !accountName.trim()) {
        return reply.status(400).send({
          success: false,
          error: 'Bank name, account number, and account name are required.',
        });
      }

      const updated = await prisma.user.update({
        where: { telegramId: BigInt(tgUser.id) },
        data: {
          bankName: bankName.trim(),
          accountNumber: accountNumber.trim(),
          accountName: accountName.trim(),
        },
        select: {
          id: true,
          bankName: true,
          accountNumber: true,
          accountName: true,
        },
      });

      return reply.send({
        success: true,
        message: 'Bank details saved successfully',
        bankDetails: {
          bankName: updated.bankName,
          accountNumber: updated.accountNumber,
          accountName: updated.accountName,
          isConfigured: true,
        },
      });
    }
  );

  // 5. Execute Sell Order
  fastify.post(
    '/sell',
    {
      schema: {
        tags: ['Trade'],
        summary: 'Execute a Sell order (deducts crypto wallet and logs trade order)',
        security: [{ telegramAuth: [] }],
        body: {
          type: 'object',
          required: ['token', 'amount'],
          properties: {
            token: { type: 'string', enum: ['USDT', 'TON'] },
            amount: { type: 'number', minimum: 0.0001 },
            bankName: { type: 'string' },
            accountNumber: { type: 'string' },
            accountName: { type: 'string' },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tgUser = (request as any).user;
      if (!tgUser) return reply.status(401).send({ error: 'Unauthorized' });

      const { token, amount, bankName, accountNumber, accountName } = request.body as {
        token: 'USDT' | 'TON';
        amount: number;
        bankName?: string;
        accountNumber?: string;
        accountName?: string;
      };

      if (!amount || amount <= 0) {
        return reply.status(400).send({ success: false, error: 'Invalid sell amount.' });
      }

      // Fetch user and wallet
      const user = await prisma.user.findUnique({
        where: { telegramId: BigInt(tgUser.id) },
        include: { wallets: true },
      });

      if (!user) {
        return reply.status(404).send({ success: false, error: 'User not found.' });
      }

      // Resolve bank details: explicit params or user settings
      const finalBankName = (bankName || user.bankName || '').trim();
      const finalAccountNumber = (accountNumber || user.accountNumber || '').trim();
      const finalAccountName = (accountName || user.accountName || '').trim();

      if (!finalBankName || !finalAccountNumber || !finalAccountName) {
        return reply.status(400).send({
          success: false,
          error: 'Bank details not configured. Please set up your bank details in Settings first.',
        });
      }

      const wallet = user.wallets.find((w) => w.currency === token);
      const currentBalance = wallet ? parseFloat(wallet.balance.toString()) : 0;

      if (currentBalance < amount) {
        return reply.status(400).send({
          success: false,
          error: `Insufficient balance. Available: ${currentBalance.toFixed(4)} ${token}, requested: ${amount} ${token}`,
        });
      }

      // Get live rate for token
      const ratesData = await getLiveTokenRates();
      const tokenRate = ratesData.rates[token]?.rateNgn || (token === 'USDT' ? 1680 : 8500);
      const nairaAmount = Math.round(amount * tokenRate);

      const reference = `SELL-${Date.now().toString(36).toUpperCase()}-${Math.floor(
        1000 + Math.random() * 9000
      )}`;

      try {
        const result = await prisma.$transaction(async (tx) => {
          // 1. Deduct wallet balance
          const updatedWallet = await tx.wallet.update({
            where: {
              userId_currency: {
                userId: user.id,
                currency: token,
              },
            },
            data: {
              balance: { decrement: amount },
            },
          });

          // 2. Record Transaction
          const txRecord = await tx.transaction.create({
            data: {
              walletId: updatedWallet.id,
              amount: amount,
              type: TransactionType.TRADE_SELL,
              status: TransactionStatus.COMPLETED,
              assetSymbol: token,
              executionPrice: tokenRate,
              externalTxId: reference,
            },
          });

          // 3. Create TradeOrder
          const tradeOrder = await tx.tradeOrder.create({
            data: {
              userId: user.id,
              type: TradeType.SELL,
              token: token,
              cryptoAmount: amount,
              nairaAmount: nairaAmount,
              rateNgn: tokenRate,
              status: TradeOrderStatus.COMPLETED,
              bankName: finalBankName,
              accountNumber: finalAccountNumber,
              accountName: finalAccountName,
              reference: reference,
            },
          });

          return { updatedWallet, txRecord, tradeOrder };
        });

        return reply.send({
          success: true,
          message: 'Sell completed successfully! Payout is processing.',
          order: {
            id: result.tradeOrder.id,
            reference: result.tradeOrder.reference,
            token: result.tradeOrder.token,
            cryptoAmount: parseFloat(result.tradeOrder.cryptoAmount.toString()),
            nairaAmount: parseFloat(result.tradeOrder.nairaAmount.toString()),
            rateNgn: parseFloat(result.tradeOrder.rateNgn.toString()),
            bankName: result.tradeOrder.bankName,
            accountNumber: result.tradeOrder.accountNumber,
            accountName: result.tradeOrder.accountName,
            newBalance: parseFloat(result.updatedWallet.balance.toString()),
            createdAt: result.tradeOrder.createdAt,
          },
        });
      } catch (txErr: any) {
        fastify.log.error(txErr);
        return reply.status(500).send({
          success: false,
          error: 'Transaction failed',
          message: txErr.message,
        });
      }
    }
  );

  // 6. Execute Buy Order (Funds user's crypto wallet upon confirmation)
  fastify.post(
    '/buy',
    {
      schema: {
        tags: ['Trade'],
        summary: 'Execute a Buy order (credits crypto wallet and logs trade order)',
        security: [{ telegramAuth: [] }],
        body: {
          type: 'object',
          required: ['token', 'amount'],
          properties: {
            token: { type: 'string', enum: ['USDT', 'TON'] },
            amount: { type: 'number', minimum: 0.0001 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tgUser = (request as any).user;
      if (!tgUser) return reply.status(401).send({ error: 'Unauthorized' });

      const { token, amount } = request.body as {
        token: 'USDT' | 'TON';
        amount: number;
      };

      if (!amount || amount <= 0) {
        return reply.status(400).send({ success: false, error: 'Invalid buy amount.' });
      }

      const user = await prisma.user.findUnique({
        where: { telegramId: BigInt(tgUser.id) },
        include: { wallets: true },
      });

      if (!user) {
        return reply.status(404).send({ success: false, error: 'User not found.' });
      }

      // Get live rate for token
      const ratesData = await getLiveTokenRates();
      const tokenRate = ratesData.rates[token]?.rateNgn || (token === 'USDT' ? 1680 : 8500);
      const nairaAmount = Math.round(amount * tokenRate);

      const reference = `BUY-${Date.now().toString(36).toUpperCase()}-${Math.floor(
        1000 + Math.random() * 9000
      )}`;

      try {
        const result = await prisma.$transaction(async (tx) => {
          // 1. Credit wallet balance
          const walletAddress = token === 'TON' ? user.tonDepositAddress : user.bep20DepositAddress;
          const updatedWallet = await tx.wallet.upsert({
            where: {
              userId_currency: {
                userId: user.id,
                currency: token,
              },
            },
            update: {
              balance: { increment: amount },
            },
            create: {
              userId: user.id,
              currency: token,
              address: walletAddress,
              balance: amount,
            },
          });

          // 2. Record Transaction
          const txRecord = await tx.transaction.create({
            data: {
              walletId: updatedWallet.id,
              amount: amount,
              type: TransactionType.TRADE_BUY,
              status: TransactionStatus.COMPLETED,
              assetSymbol: token,
              executionPrice: tokenRate,
              externalTxId: reference,
            },
          });

          // 3. Create TradeOrder
          const tradeOrder = await tx.tradeOrder.create({
            data: {
              userId: user.id,
              type: TradeType.BUY,
              token: token,
              cryptoAmount: amount,
              nairaAmount: nairaAmount,
              rateNgn: tokenRate,
              status: TradeOrderStatus.COMPLETED,
              reference: reference,
            },
          });

          return { updatedWallet, txRecord, tradeOrder };
        });

        return reply.send({
          success: true,
          message: 'Payment confirmed! Your wallet has been credited.',
          order: {
            id: result.tradeOrder.id,
            reference: result.tradeOrder.reference,
            token: result.tradeOrder.token,
            cryptoAmount: parseFloat(result.tradeOrder.cryptoAmount.toString()),
            nairaAmount: parseFloat(result.tradeOrder.nairaAmount.toString()),
            rateNgn: parseFloat(result.tradeOrder.rateNgn.toString()),
            newBalance: parseFloat(result.updatedWallet.balance.toString()),
            createdAt: result.tradeOrder.createdAt,
          },
        });
      } catch (txErr: any) {
        fastify.log.error(txErr);
        return reply.status(500).send({
          success: false,
          error: 'Transaction failed',
          message: txErr.message,
        });
      }
    }
  );
}
