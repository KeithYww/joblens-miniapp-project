import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import crypto from 'crypto';
import { registerRoutes } from './routes';
import { initRedis, isRedisAvailable, redis } from './db/redis';
import { checkDbConnection, getDbHealth, isDbAvailable, prisma } from './db/prisma';
import { recordApiResponse } from './services/operationalMetrics';

const isProduction = process.env.NODE_ENV === 'production';
const defaultCorsOrigins = ['http://localhost:5173', 'http://localhost:3000'];
const configuredCorsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

function readBoundedInteger(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function resolveTrustProxy(): boolean | number | string[] {
  const raw = process.env.TRUST_PROXY?.trim();
  if (!raw) return isProduction ? 1 : false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^\d+$/.test(raw)) {
    const hops = Number(raw);
    if (!Number.isSafeInteger(hops) || hops < 1 || hops > 32) {
      throw new Error('TRUST_PROXY hop count must be between 1 and 32');
    }
    return hops;
  }

  const proxies = raw.split(',').map(value => value.trim()).filter(Boolean);
  if (proxies.length === 0) throw new Error('TRUST_PROXY must be true, false, a hop count, or a comma-separated proxy list');
  return proxies;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

export async function createServer(): Promise<FastifyInstance> {
  if (isProduction && configuredCorsOrigins.length === 0) {
    throw new Error('CORS_ORIGIN is required in production');
  }

  const app = fastify({
    logger: true,
    trustProxy: resolveTrustProxy(),
    bodyLimit: readBoundedInteger('BODY_LIMIT_BYTES', 1_048_576, 16_384, 10_485_760),
    requestTimeout: readBoundedInteger('REQUEST_TIMEOUT_MS', 120_000, 5_000, 300_000),
    connectionTimeout: readBoundedInteger('CONNECTION_TIMEOUT_MS', 90_000, 5_000, 300_000),
    keepAliveTimeout: readBoundedInteger('KEEP_ALIVE_TIMEOUT_MS', 72_000, 1_000, 120_000),
    maxRequestsPerSocket: readBoundedInteger('MAX_REQUESTS_PER_SOCKET', 1_000, 1, 100_000),
    genReqId: () => `req_${crypto.randomBytes(12).toString('hex')}`,
  });

  await app.register(cors, {
    origin: isProduction ? configuredCorsOrigins : [...defaultCorsOrigins, ...configuredCorsOrigins],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-visitor-id'],
    exposedHeaders: [
      'x-joblens-analysis-source',
      'x-joblens-ai-provider',
      'x-joblens-ai-model',
      'x-joblens-ai-latency-ms',
      'x-joblens-quota-remaining',
      'x-joblens-quota-reset-at',
    ],
    maxAge: 600,
  });

  app.addHook('onSend', async (_request, reply) => {
    reply.headers({
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-resource-policy': 'same-site',
      'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'x-permitted-cross-domain-policies': 'none',
    });
    if (isProduction) {
      reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (!path.startsWith('/api/') || path === '/api/health' || path === '/api/internal/metrics' || path === '/api/client-errors') return;
    await recordApiResponse(reply.statusCode);
  });

  await registerRoutes(app);

  app.get('/api/health', async (_request, reply) => {
    const database = getDbHealth();
    const redisAvailable = isRedisAvailable();
    const databaseRequired = readBoolean('REQUIRE_DATABASE', isProduction);
    const redisRequired = readBoolean('REQUIRE_REDIS', isProduction);
    const healthy = (!databaseRequired || database.available) && (!redisRequired || redisAvailable);
    return reply.status(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      dependencies: {
        database: database.available,
        redis: redisAvailable,
      },
    });
  });

  return app;
}

async function startServer() {
  let app: FastifyInstance | undefined;
  try {
    app = await createServer();
    await Promise.all([initRedis(), checkDbConnection()]);
    if (readBoolean('REQUIRE_DATABASE', isProduction) && !isDbAvailable()) {
      throw new Error('Required PostgreSQL dependency is unavailable');
    }
    if (readBoolean('REQUIRE_REDIS', isProduction) && !isRedisAvailable()) {
      throw new Error('Required Redis dependency is unavailable');
    }

    const PORT = readBoundedInteger('PORT', 3000, 1, 65_535);
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`Server running on http://localhost:${PORT}`);

    const shutdown = async (signal: string) => {
      console.log(`Received ${signal}; shutting down`);
      await Promise.allSettled([
        app?.close(),
        redis.quit(),
        prisma.$disconnect(),
      ]);
    };
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    process.once('SIGINT', () => void shutdown('SIGINT'));
  } catch (err) {
    console.error('Server startup failed:', err instanceof Error ? err.message : 'unknown error');
    await Promise.allSettled([app?.close(), redis.disconnect(), prisma.$disconnect()]);
    process.exit(1);
  }
}

if (require.main === module) {
  void startServer();
}
