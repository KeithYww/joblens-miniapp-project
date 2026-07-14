import { existsSync } from 'node:fs';

const localEnvFile = '.env';

// Static imports initialize dependencies before index.ts runs, so load local settings here.
// Production values are injected by Docker or the hosting platform; tests must stay isolated.
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test' && existsSync(localEnvFile)) {
  process.loadEnvFile(localEnvFile);
}
