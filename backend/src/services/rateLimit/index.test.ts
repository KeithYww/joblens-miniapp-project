import assert from 'node:assert/strict';
import test from 'node:test';
import { checkRateLimit, incrementRateLimit, verifyCaptcha } from './index';

test('captcha fails closed when the secret is missing', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousSecret = process.env.TURNSTILE_SECRET_KEY;
  const previousBypass = process.env.CAPTCHA_BYPASS;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.TURNSTILE_SECRET_KEY;
    process.env.CAPTCHA_BYPASS = 'true';
    assert.deepEqual(await verifyCaptcha('valid-looking-token'), {
      success: false,
      reason: 'CAPTCHA_NOT_CONFIGURED',
    });
  } finally {
    restoreEnv('NODE_ENV', previousNodeEnv);
    restoreEnv('TURNSTILE_SECRET_KEY', previousSecret);
    restoreEnv('CAPTCHA_BYPASS', previousBypass);
  }
});

test('captcha verification sends a normalized remote IP without exposing the secret', async () => {
  const previousFetch = globalThis.fetch;
  const previousSecret = process.env.TURNSTILE_SECRET_KEY;
  let submittedBody = '';
  try {
    process.env.TURNSTILE_SECRET_KEY = 'turnstile-secret-for-test';
    globalThis.fetch = async (_input, init) => {
      submittedBody = String(init?.body);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    assert.deepEqual(await verifyCaptcha('challenge-token', '127.0.0.1'), { success: true });
    const form = new URLSearchParams(submittedBody);
    assert.equal(form.get('remoteip'), '127.0.0.1');
    assert.equal(form.get('response'), 'challenge-token');
    assert.equal(form.get('secret'), 'turnstile-secret-for-test');
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv('TURNSTILE_SECRET_KEY', previousSecret);
  }
});

test('write limits require a captcha after the configured short-window threshold', async () => {
  const ip = '203.0.113.9';
  const visitorId = 'visitor_123456abcdef123456abcdef123456ab';
  const path = `/api/test-rate-limit-${Date.now()}`;

  for (let index = 0; index < 5; index += 1) {
    const before = await checkRateLimit(ip, visitorId, path);
    assert.equal(before.blocked, false);
    assert.equal(before.requiresCaptcha, false);
    await incrementRateLimit(ip, visitorId, path);
  }

  const limited = await checkRateLimit(ip, visitorId, path);
  assert.equal(limited.blocked, false);
  assert.equal(limited.requiresCaptcha, true);
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
