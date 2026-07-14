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

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
