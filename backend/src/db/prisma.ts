import { PrismaClient } from '@prisma/client';

declare global {
  var prisma: PrismaClient | undefined;
}

export const prisma = globalThis.prisma || new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/joblens',
    },
  },
});

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}

let dbAvailable = false;
let lastCheckedAt: Date | null = null;
let lastError: string | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

const DB_RECHECK_INTERVAL_MS = 30_000;

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await checkDbConnection();
  }, DB_RECHECK_INTERVAL_MS);
  reconnectTimer.unref();
}

export function markDbUnavailable(error: unknown): void {
  dbAvailable = false;
  lastCheckedAt = new Date();
  lastError = error instanceof Error ? error.message : String(error);
  scheduleReconnect();
}

export async function checkDbConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
    lastCheckedAt = new Date();
    lastError = null;
  } catch (error) {
    markDbUnavailable(error);
    console.error('Database health check failed:', lastError);
  }
  return dbAvailable;
}

export function isDbAvailable(): boolean {
  if (!dbAvailable && (!lastCheckedAt || Date.now() - lastCheckedAt.getTime() >= DB_RECHECK_INTERVAL_MS)) {
    void checkDbConnection();
  }
  return dbAvailable;
}

export function getDbHealth(): { available: boolean; last_checked_at: string | null; error: string | null } {
  return {
    available: dbAvailable,
    last_checked_at: lastCheckedAt?.toISOString() || null,
    error: lastError,
  };
}

export async function runDbOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    const result = await operation();
    dbAvailable = true;
    lastCheckedAt = new Date();
    lastError = null;
    return result;
  } catch (error) {
    const code = (error as { code?: string }).code;
    const message = error instanceof Error ? error.message : String(error);
    if ((code && /^P10\d\d$/.test(code)) || /connection|connect|database server|timed out/i.test(message)) {
      markDbUnavailable(error);
    }
    throw error;
  }
}
