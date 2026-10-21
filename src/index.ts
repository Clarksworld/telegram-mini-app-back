import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { validateTelegramInitData } from './auth';

dotenv.config();

const fastify = Fastify({ logger: true });

// In Prisma v6, we use the standard client connection
const prisma = new PrismaClient({
  log: ['error', 'warn'],
});

// Add a health check for the database connection
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
  if (request.url === '/health') return;

  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('tma ')) {
    return reply.status(401).send({ error: 'Missing or invalid authorization header' });
  }

  const initData = authHeader.replace('tma ', '');
  if (!validateTelegramInitData(initData, BOT_TOKEN)) {
    return reply.status(401).send({ error: 'Invalid Telegram initData' });
  }

  const urlParams = new URLSearchParams(initData);
  const userJson = urlParams.get('user');
  if (userJson) {
    (request as any).user = JSON.parse(userJson);
  }
});

// Endpoints
fastify.get('/health', async () => {
  return { status: 'ok' };
});

fastify.get('/profile', async (request, reply) => {
  const tgUser = (request as any).user;

  try {
    // Upsert user in database
    // CRITICAL: telegramId must be cast to BigInt for Prisma
    const user = await prisma.user.upsert({
      where: { telegramId: BigInt(tgUser.id) },
      update: {
        username: tgUser.username,
        firstName: tgUser.first_name,
        lastName: tgUser.last_name,
        languageCode: tgUser.language_code,
      },
      create: {
        telegramId: BigInt(tgUser.id),
        username: tgUser.username,
        firstName: tgUser.first_name,
        lastName: tgUser.last_name,
        languageCode: tgUser.language_code,
      },
    });

    return {
      user: user,
      message: 'Welcome to the Trading App!',
    };
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({
      error: 'Internal Server Error',
      details: error instanceof Error ? error.message : 'Unknown database error'
    });
  }
});

const start = async () => {
  try {
    // 1. Verify Database Connection first
    await checkDbConnection();

    // 2. Run migrations before starting the server
    console.log('Running database migrations...');
    const { execSync } = require('child_process');
    execSync('npx prisma migrate deploy', { stdio: 'inherit' });
    console.log('Database migrations completed successfully.');

    await fastify.listen({ port: Number(process.env.PORT) || 3001, host: '0.0.0.0' });
    const address = fastify.server.address();
    const port = typeof address === 'string' ? address : address?.port;
    console.log(`Server listening on ${port || 3001}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
