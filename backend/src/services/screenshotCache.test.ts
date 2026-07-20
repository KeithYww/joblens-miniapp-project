import assert from 'node:assert/strict';
import test from 'node:test';
import { isScreenshotExtractionSafeToCache, runOcrSingleflight } from './screenshotCache';

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

test('visitor-scoped singleflight runs one leader and shares its result', async () => {
  let leaders = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const runLeader = async () => {
    leaders += 1;
    await gate;
    return { value: 'shared' };
  };

  const first = runOcrSingleflight('visitor-key-success', runLeader);
  const second = runOcrSingleflight('visitor-key-success', runLeader);
  release();
  const [leader, follower] = await Promise.all([first, second]);

  assert.equal(leaders, 1);
  assert.equal(leader.leader, true);
  assert.equal(follower.leader, false);
  assert.deepEqual(follower.value, leader.value);
});

test('singleflight followers receive the leader failure without a retry', async () => {
  let leaders = 0;
  let reject!: (error: Error) => void;
  const gate = new Promise<never>((_resolve, rejectPromise) => { reject = rejectPromise; });
  const runLeader = async () => {
    leaders += 1;
    return gate;
  };

  const first = runOcrSingleflight('visitor-key-failure', runLeader);
  const second = runOcrSingleflight('visitor-key-failure', runLeader);
  reject(new Error('leader failed'));
  const settled = await Promise.allSettled([first, second]);

  assert.equal(leaders, 1);
  assert.equal(settled[0].status, 'rejected');
  assert.equal(settled[1].status, 'rejected');
  assert.equal((settled[0] as PromiseRejectedResult).reason, (settled[1] as PromiseRejectedResult).reason);
});
