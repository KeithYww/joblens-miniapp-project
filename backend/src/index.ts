import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { registerRoutes } from '@/routes';
import { initRedis } from '@/db/redis';
import { checkDbConnection } from '@/db/prisma';

async function createServer(): Promise<FastifyInstance> {
  const app = fastify({
    logger: true,
    genReqId: () => {
      return `req_${Math.random().toString(36).slice(2, 14)}`;
    },
  });

  await app.register(cors, {
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-visitor-id'],
  });

  await registerRoutes(app);

  app.get('/api/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  return app;
}

async function startServer() {
  const app = await createServer();
  await initRedis();
  await checkDbConnection();

  const PORT = parseInt(process.env.PORT || '3000');

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`Server running on http://localhost:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

startServer();
