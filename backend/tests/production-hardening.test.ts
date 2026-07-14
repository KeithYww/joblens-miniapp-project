import assert from 'node:assert/strict';
import test from 'node:test';
import fastify from 'fastify';

const VISITOR_A = 'visitor_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const VISITOR_B = 'visitor_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const VISITOR_C = 'visitor_cccccccccccccccccccccccccccccccc';
const validJd = '本岗位负责产品运营、用户研究、数据分析和跨部门协作，提供固定薪资、劳动合同及社保，工作职责和考核标准会在面试时书面说明。';

test('production data safety routes', { timeout: 30_000 }, async () => {
  process.env.AI_PROVIDER = 'rule-based';
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:1/joblens?connect_timeout=1';

  const [{ registerRoutes }, { checkDbConnection, prisma }, { containsHighSensitiveData }] = await Promise.all([
    import('../src/routes'),
    import('../src/db/prisma'),
    import('../src/schemas'),
  ]);
  await checkDbConnection();

  assert.equal(containsHighSensitiveData(['联系电话 13800138000']), true);
  assert.equal(containsHighSensitiveData(['身份证 11010519491231002X']), true);
  assert.equal(containsHighSensitiveData(['银行卡 4111 1111 1111 1111']), true);
  assert.equal(containsHighSensitiveData(['普通岗位文本 2026 年发布']), false);

  const app = fastify({ logger: false });
  await registerRoutes(app);

  const missingVisitor = await app.inject({
    method: 'POST',
    url: '/api/reports/detect',
    payload: { jd_text: validJd },
  });
  assert.equal(missingVisitor.statusCode, 400);
  assert.equal(missingVisitor.json().error, 'INVALID_VISITOR_ID');

  const legacyVisitor = await app.inject({
    method: 'POST',
    url: '/api/reports/detect',
    headers: { 'x-visitor-id': 'visitor_dddddddddddd' },
    payload: { jd_text: validJd },
  });
  assert.equal(legacyVisitor.statusCode, 200);

  const sensitiveDetect = await app.inject({
    method: 'POST',
    url: '/api/reports/detect',
    headers: { 'x-visitor-id': VISITOR_A },
    payload: { jd_text: `${validJd} 联系人手机号 13800138000` },
  });
  assert.equal(sensitiveDetect.statusCode, 400);
  assert.equal(sensitiveDetect.json().error, 'SENSITIVE_DATA_DETECTED');

  const sensitiveStructuredField = await app.inject({
    method: 'POST',
    url: '/api/reports/detect',
    headers: { 'x-visitor-id': VISITOR_A },
    payload: { company_name: '联系人13800138000', jd_text: validJd },
  });
  assert.equal(sensitiveStructuredField.statusCode, 400);
  assert.equal(sensitiveStructuredField.json().error, 'SENSITIVE_DATA_DETECTED');

  const createA = await app.inject({
    method: 'POST',
    url: '/api/reports/detect',
    headers: { 'x-visitor-id': VISITOR_A },
    payload: { company_name: '示例公司', job_title: '产品运营', source_platform: '官网', jd_text: validJd },
  });
  assert.equal(createA.statusCode, 200);
  const reportA = createA.json().report_id as string;

  const ownRead = await app.inject({ method: 'GET', url: `/api/reports/${reportA}`, headers: { 'x-visitor-id': VISITOR_A } });
  assert.equal(ownRead.statusCode, 200);
  const foreignRead = await app.inject({ method: 'GET', url: `/api/reports/${reportA}`, headers: { 'x-visitor-id': VISITOR_B } });
  assert.equal(foreignRead.statusCode, 404);

  const foreignHr = await app.inject({
    method: 'POST',
    url: `/api/reports/${reportA}/hr-analysis`,
    headers: { 'x-visitor-id': VISITOR_B },
    payload: { user_question: '请问这个岗位的固定底薪是多少？', hr_reply: '薪资需要到现场面试以后再详细沟通。' },
  });
  assert.equal(foreignHr.statusCode, 404);

  const sensitiveHr = await app.inject({
    method: 'POST',
    url: `/api/reports/${reportA}/hr-analysis`,
    headers: { 'x-visitor-id': VISITOR_A },
    payload: { user_question: '请问这个岗位的固定底薪是多少？', hr_reply: '请联系手机号 13900139000 再详细沟通。' },
  });
  assert.equal(sensitiveHr.statusCode, 400);
  assert.equal(sensitiveHr.json().error, 'SENSITIVE_DATA_DETECTED');

  const ownHr = await app.inject({
    method: 'POST',
    url: `/api/reports/${reportA}/hr-analysis`,
    headers: { 'x-visitor-id': VISITOR_A },
    payload: { user_question: '请问这个岗位的固定底薪是多少？', hr_reply: '固定底薪会写在正式劳动合同中，可以提前提供薪资结构。' },
  });
  assert.equal(ownHr.statusCode, 200);

  const foreignFeedback = await app.inject({
    method: 'POST',
    url: '/api/report-feedbacks',
    headers: { 'x-visitor-id': VISITOR_B },
    payload: { report_id: reportA, feedback_type: '证据不足', content: '这份报告没有覆盖我最关心的薪资构成信息。' },
  });
  assert.equal(foreignFeedback.statusCode, 404);

  const foreignDelete = await app.inject({ method: 'DELETE', url: `/api/reports/${reportA}`, headers: { 'x-visitor-id': VISITOR_B } });
  assert.equal(foreignDelete.statusCode, 404);
  const ownDelete = await app.inject({ method: 'DELETE', url: `/api/reports/${reportA}`, headers: { 'x-visitor-id': VISITOR_A } });
  assert.equal(ownDelete.statusCode, 200);
  const deletedRead = await app.inject({ method: 'GET', url: `/api/reports/${reportA}`, headers: { 'x-visitor-id': VISITOR_A } });
  assert.equal(deletedRead.statusCode, 404);

  const recreateA = await app.inject({
    method: 'POST',
    url: '/api/reports/detect',
    headers: { 'x-visitor-id': VISITOR_A },
    payload: { company_name: '示例公司', job_title: '产品运营', source_platform: '官网', jd_text: validJd },
  });
  assert.equal(recreateA.statusCode, 200);
  assert.notEqual(recreateA.json().report_id, reportA);

  const createB = await app.inject({
    method: 'POST',
    url: '/api/reports/detect',
    headers: { 'x-visitor-id': VISITOR_B },
    payload: { company_name: '示例公司', job_title: '产品运营', source_platform: '官网', jd_text: validJd },
  });
  assert.equal(createB.statusCode, 200);
  const reportB = createB.json().report_id as string;
  assert.notEqual(reportB, recreateA.json().report_id);

  const linkedHrB = await app.inject({
    method: 'POST',
    url: `/api/reports/${reportB}/hr-analysis`,
    headers: { 'x-visitor-id': VISITOR_B },
    payload: { user_question: '请问劳动合同主体和社保主体一致吗？', hr_reply: '两者主体一致，入职当天可以查看完整合同文本。' },
  });
  assert.equal(linkedHrB.statusCode, 200);

  const interviewB = await app.inject({
    method: 'POST',
    url: '/api/interview-feedbacks',
    headers: { 'x-visitor-id': VISITOR_B },
    payload: {
      report_id: reportB,
      company_name: '示例公司',
      job_title: '产品运营',
      source_platform: '官网',
      jd_claim: '岗位说明承诺主要负责产品运营与数据分析。',
      interview_actual: '面试过程与岗位说明基本一致，并说明了薪资结构。',
      involves_sales: false,
      involves_fee: false,
      involves_training_loan: false,
      involves_deposit: false,
      subject_mismatch: false,
      recommend_to_others: '推荐',
    },
  });
  assert.equal(interviewB.statusCode, 200);

  const reportFeedbackB = await app.inject({
    method: 'POST',
    url: '/api/report-feedbacks',
    headers: { 'x-visitor-id': VISITOR_B },
    payload: { report_id: reportB, feedback_type: '证据不足', content: '报告可以进一步说明风险分数对应的证据来源。' },
  });
  assert.equal(reportFeedbackB.statusCode, 200);

  const sensitiveInterview = await app.inject({
    method: 'POST',
    url: '/api/interview-feedbacks',
    headers: { 'x-visitor-id': VISITOR_C },
    payload: {
      company_name: '示例公司', job_title: '产品运营',
      jd_claim: '岗位说明承诺主要负责产品运营与数据分析。',
      interview_actual: '面试官要求将材料发送到手机号 13700137000。',
      involves_sales: false, involves_fee: false, involves_training_loan: false,
      involves_deposit: false, subject_mismatch: false, recommend_to_others: '中立',
    },
  });
  assert.equal(sensitiveInterview.statusCode, 400);
  assert.equal(sensitiveInterview.json().error, 'SENSITIVE_DATA_DETECTED');

  const deleteVisitorB = await app.inject({ method: 'DELETE', url: '/api/visitor-data', headers: { 'x-visitor-id': VISITOR_B } });
  assert.equal(deleteVisitorB.statusCode, 200);
  assert.deepEqual(deleteVisitorB.json().deleted, {
    reports: 1,
    hr_analyses: 1,
    interview_feedbacks: 1,
    report_feedbacks: 1,
  });
  const visitorDeletedRead = await app.inject({ method: 'GET', url: `/api/reports/${reportB}`, headers: { 'x-visitor-id': VISITOR_B } });
  assert.equal(visitorDeletedRead.statusCode, 404);

  await app.close();
  await prisma.$disconnect();
});
