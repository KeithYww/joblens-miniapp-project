import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseScreenshotExtractionResponse,
  ScreenshotNoJobInformationError,
} from './screenshotExtraction';

test('screenshot extraction keeps recruiting poster content and removes empty optional fields', () => {
  const result = parseScreenshotExtractionResponse(JSON.stringify({
    jd_text: 'Gate is hiring. The poster contains a company introduction, values, and development history.',
    company_name: 'Gate',
    job_title: '',
    source_platform: '  ',
    hr_chat_text: '',
  }));

  assert.deepEqual(result, {
    jd_text: 'Gate is hiring. The poster contains a company introduction, values, and development history.',
    company_name: 'Gate',
  });
});

test('screenshot extraction reports a specific error when no recruitment content is found', () => {
  assert.throws(
    () => parseScreenshotExtractionResponse(JSON.stringify({ jd_text: '', company_name: 'Gate' })),
    ScreenshotNoJobInformationError,
  );
});
