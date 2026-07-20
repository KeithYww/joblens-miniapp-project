import { expect, test } from '@playwright/test';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('repeated screenshot selection and removal does not retain growing JS state', async ({ page }) => {
  await page.route('**/api/ai-quota', route => route.fulfill({ json: {
    available: true,
    ocr: { remaining: 3, limit: 3 },
    analysis: { remaining: 3, limit: 3 },
    resetAt: '2026-07-21T00:00:00.000+08:00',
  } }));
  await page.goto('/');
  const input = page.locator('input[type="file"]');

  await page.requestGC();
  const before = await page.evaluate(() => (performance as Performance & { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize);
  for (let index = 0; index < 20; index += 1) {
    const name = `job-${index}.png`;
    await input.setInputFiles({ name, mimeType: 'image/png', buffer: PNG });
    await page.getByRole('button', { name: new RegExp(`(?:移除|Remove) ${name}`) }).click();
  }
  await page.requestGC();
  const after = await page.evaluate(() => (performance as Performance & { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize);

  expect(after - before).toBeLessThan(12 * 1024 * 1024);
});
