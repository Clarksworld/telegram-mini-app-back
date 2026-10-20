import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { validateTelegramInitData } from './auth';

dotenv.config();

const fastify = Fastify({ logger: true });
const prisma = new PrismaClient();

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

fastify.get('/profile', async (request) => {
  const tgUser = (request as any).user;

  // Upsert user in database
  const user = await prisma.user.upsert({
    where: { telegramId: tgUser.id },
    update: {
      username: tgUser.username,
      firstName: tgUser.first_name,
      lastName: tgUser.last_name,
      languageCode: tgUser.language_code,
    },
    create: {
      telegramId: tgUser.id,
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
});

const start = async () => {
  try {
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
