import { expect, test } from '@playwright/test';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test.beforeEach(async ({ page }) => {
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/ai-quota') {
      await route.fulfill({ json: {
        available: true,
        ocr: { remaining: 3, limit: 3 },
        analysis: { remaining: 3, limit: 3 },
        resetAt: '2026-07-21T00:00:00.000+08:00',
      } });
      return;
    }
    if (path === '/api/capabilities') {
      await route.fulfill({ json: { preferred_ocr_upload_mode: 'multipart-v2' } });
      return;
    }
    if (path === '/api/ocr/extract-job-v2') {
      expect(route.request().headers()['content-type']).toContain('multipart/form-data; boundary=');
      await route.fulfill({ json: { jd_text: 'Software engineer role with clear responsibilities.' } });
      return;
    }
    await route.fulfill({ status: 204 });
  });
});

test('screenshot selection resets and extraction state follows image revisions', async ({ page }) => {
  await page.goto('/');
  const input = page.locator('input[type="file"]');
  const image = { name: 'job.png', mimeType: 'image/png', buffer: PNG };

  await input.setInputFiles(image);
  const extract = page.getByRole('button', { name: /识别截图|Extract text/ });
  await expect(extract).toBeEnabled();
  await extract.click();

  await expect(page.getByRole('button', { name: /已识别|Extracted/ })).toBeDisabled();
  await expect(page.locator('#job-description-input')).toHaveValue('Software engineer role with clear responsibilities.');

  await input.setInputFiles({ ...image, name: 'job-updated.png' });
  await expect(page.getByRole('button', { name: /识别截图|Extract text/ })).toBeEnabled();

  await page.getByRole('button', { name: /(?:移除|Remove) job\.png/ }).click();
  await page.getByRole('button', { name: /(?:移除|Remove) job-updated\.png/ }).click();
  await expect(page.getByRole('button', { name: /识别截图|Extract text/ })).toHaveCount(0);

  await input.setInputFiles(image);
  await expect(page.getByRole('button', { name: /识别截图|Extract text/ })).toBeEnabled();
});
