import assert from 'node:assert/strict';
import test from 'node:test';
import { isScreenshotExtractionSafeToCache } from './screenshotCache';

test('OCR cache rejects extracted high-sensitive identifiers', () => {
  assert.equal(isScreenshotExtractionSafeToCache({
    jd_text: '岗位负责数据分析和运营管理，联系手机号 13800138000。',
  }), false);
  assert.equal(isScreenshotExtractionSafeToCache({
    jd_text: '岗位负责数据分析和运营管理。',
    hr_chat_text: '请携带身份证 11010519491231002X 到场。',
  }), false);
  assert.equal(isScreenshotExtractionSafeToCache({
    jd_text: '岗位负责数据分析和运营管理。',
    hr_chat_text: '工资卡号请填写 4111 1111 1111 1111。',
  }), false);
});

test('OCR cache accepts ordinary job content and masked identifiers', () => {
  assert.equal(isScreenshotExtractionSafeToCache({
    jd_text: '岗位负责数据分析和运营管理，薪资 30-60K。',
    hr_chat_text: '如需联系，请使用已打码号码 138****8000。',
  }), true);
});
