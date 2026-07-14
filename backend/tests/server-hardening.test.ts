import assert from 'node:assert/strict';
import test from 'node:test';

test('health reports required dependency degradation and emits security headers', async () => {
  const previousRequireDatabase = process.env.REQUIRE_DATABASE;
  const previousRequireRedis = process.env.REQUIRE_REDIS;
  const previousAiProvider = process.env.AI_PROVIDER;
  try {
    process.env.AI_PROVIDER = 'rule-based';
    process.env.REQUIRE_DATABASE = 'true';
    process.env.REQUIRE_REDIS = 'true';
    const { createServer } = await import('../src/index');
    const app = await createServer();

    const response = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().status, 'degraded');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['x-frame-options'], 'DENY');

    const writeResponse = await app.inject({
      method: 'POST',
      url: '/api/reports/detect',
      headers: { 'x-visitor-id': 'visitor_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      payload: { jd_text: '用于依赖门禁检查的岗位描述。'.repeat(8) },
    });
    assert.equal(writeResponse.statusCode, 503);
    assert.equal(writeResponse.json().error, 'DEPENDENCY_UNAVAILABLE');

    await app.close();
  } finally {
    restoreEnv('REQUIRE_DATABASE', previousRequireDatabase);
    restoreEnv('REQUIRE_REDIS', previousRequireRedis);
    restoreEnv('AI_PROVIDER', previousAiProvider);
  }
});

test('operational metrics require a bearer token and client errors are accepted safely', async () => {
  const previous = {
    REQUIRE_DATABASE: process.env.REQUIRE_DATABASE,
    REQUIRE_REDIS: process.env.REQUIRE_REDIS,
    MONITORING_TOKEN: process.env.MONITORING_TOKEN,
  };
  process.env.REQUIRE_DATABASE = 'false';
  process.env.REQUIRE_REDIS = 'false';
  process.env.MONITORING_TOKEN = 'test-monitoring-token-with-sufficient-entropy';
  const { createServer } = await import('../src/index');
  const app = await createServer();
  try {
    const missingToken = await app.inject({ method: 'GET', url: '/api/internal/metrics' });
    assert.equal(missingToken.statusCode, 401);
    assert.equal(missingToken.json().error, 'UNAUTHORIZED');

    const wrongToken = await app.inject({
      method: 'GET',
      url: '/api/internal/metrics',
      headers: { authorization: 'Bearer wrong-token' },
    });
    assert.equal(wrongToken.statusCode, 401);

    const missingBackupToken = await app.inject({ method: 'GET', url: '/api/internal/backup' });
    assert.equal(missingBackupToken.statusCode, 401);
    assert.equal(missingBackupToken.json().error, 'UNAUTHORIZED');

    const acceptedError = await app.inject({
      method: 'POST',
      url: '/api/client-errors',
      headers: { 'x-visitor-id': 'visitor_cccccccccccccccccccccccccccccccc' },
      payload: {
        kind: 'error',
        message: 'Example rendering failure',
        source: '/assets/index.js',
        path: '/report/example',
        line: 12,
        column: 8,
      },
    });
    assert.equal(acceptedError.statusCode, 202);
    assert.equal(acceptedError.json().status, 'accepted');
  } finally {
    await app.close();
    for (const [name, value] of Object.entries(previous)) restoreEnv(name, value);
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
