import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

const databaseConfigured = Boolean(process.env.DATABASE_URL);

test('admin dashboard aggregates, redacts and reviews production data', { skip: !databaseConfigured, timeout: 30_000 }, async () => {
  const suffix = crypto.randomBytes(6).toString('hex');
  const modelReportId = `rep_${suffix}`;
  const fallbackReportId = `rep_${crypto.randomBytes(6).toString('hex')}`;
  const feedbackId = `rfb_${crypto.randomBytes(6).toString('hex')}`;
  const companyName = `后台集成测试-${suffix}`;
  const startedAt = new Date();
  const previous = {
    ADMIN_TOKEN: process.env.ADMIN_TOKEN,
    MONITORING_TOKEN: process.env.MONITORING_TOKEN,
    BACKUP_TOKEN: process.env.BACKUP_TOKEN,
    REQUIRE_DATABASE: process.env.REQUIRE_DATABASE,
    REQUIRE_REDIS: process.env.REQUIRE_REDIS,
    AI_PROVIDER: process.env.AI_PROVIDER,
  };
  process.env.ADMIN_TOKEN = 'test-admin-token-with-independent-sufficient-entropy';
  process.env.MONITORING_TOKEN = 'test-monitor-token-with-independent-sufficient-entropy';
  process.env.BACKUP_TOKEN = 'test-backup-token-with-independent-sufficient-entropy';
  process.env.REQUIRE_DATABASE = 'false';
  process.env.REQUIRE_REDIS = 'false';
  process.env.AI_PROVIDER = 'rule-based';

  const [{ createServer }, { checkDbConnection, prisma }] = await Promise.all([
    import('../src/index'),
    import('../src/db/prisma'),
  ]);
  assert.equal(await checkDbConnection(), true);
  const app = await createServer();

  const reportData = {
    source_platform: '官网',
    company_name: companyName,
    job_title: '数据产品经理',
    jd_text: '用于管理后台集成测试的岗位描述，不包含任何真实用户数据。',
    hr_chat_text: null,
    visitor_id: `visitor_${crypto.randomBytes(16).toString('hex')}`,
    ip_address: '203.0.113.8',
    overall_score: 82,
    risk_level: '高',
    confidence: '高',
    predicted_role: '销售顾问',
    risk_types: ['岗位包装'],
    sub_scores: {},
    strong_risk_adjustment: 10,
    evidence: ['测试证据用于验证管理后台详情字段。'],
    missing_info: ['固定薪资'],
    questions: ['请说明固定薪资与绩效薪资的具体比例。'],
    recommendation: '建议核实后再决定是否面试。',
    disclaimer: '本结果仅供求职决策参考，不构成法律认定。',
    analysis_status: 'completed',
    model_version: 'test',
    prompt_version: 'test',
    latency_ms: 1200,
    input_tokens: 100,
    output_tokens: 200,
    cost_estimate: 0.01,
    retention_until: new Date(Date.now() + 86_400_000),
  } as const;

  try {
    await prisma.jobReport.create({ data: {
      ...reportData,
      report_id: modelReportId,
      input_hash: crypto.randomBytes(32).toString('hex'),
      provider: 'siliconflow',
      model: 'test-model',
    } });
    await prisma.jobReport.create({ data: {
      ...reportData,
      report_id: fallbackReportId,
      input_hash: crypto.randomBytes(32).toString('hex'),
      company_name: `${companyName}-fallback`,
      overall_score: 25,
      risk_level: '低',
      provider: 'rule-based',
      model: 'rule-v1',
    } });
    await prisma.reportFeedback.create({ data: {
      feedback_id: feedbackId,
      report_id: modelReportId,
      feedback_type: '判断不准',
      content: '这是一条用于验证管理后台审核闭环的测试反馈内容。',
      visitor_id: reportData.visitor_id,
      ip_address: reportData.ip_address,
      retention_until: new Date(Date.now() + 86_400_000),
    } });

    const missing = await app.inject({ method: 'GET', url: '/api/admin/overview?days=7' });
    assert.equal(missing.statusCode, 401);
    const crossPurpose = await app.inject({ method: 'GET', url: '/api/admin/overview?days=7', headers: { authorization: `Bearer ${process.env.MONITORING_TOKEN}` } });
    assert.equal(crossPurpose.statusCode, 401);

    const headers = { authorization: `Bearer ${process.env.ADMIN_TOKEN}` };
    const overview = await app.inject({ method: 'GET', url: '/api/admin/overview?days=7', headers });
    assert.equal(overview.statusCode, 200);
    assert.ok(overview.json().kpis.reports >= 2);
    assert.ok(overview.json().kpis.pending_feedback >= 1);
    assert.equal('ip_address' in overview.json().recent_reports[0], false);
    assert.equal('visitor_id' in overview.json().recent_reports[0], false);

    const reports = await app.inject({ method: 'GET', url: `/api/admin/reports?query=${encodeURIComponent(companyName)}&page=1&page_size=20`, headers });
    assert.equal(reports.statusCode, 200);
    assert.equal(reports.json().total, 2);
    assert.equal(reports.json().items.some((item: Record<string, unknown>) => 'input_hash' in item || 'ip_address' in item || 'visitor_id' in item), false);

    const feedbacks = await app.inject({ method: 'GET', url: '/api/admin/feedbacks?kind=report&status=pending&page=1&page_size=100', headers });
    assert.equal(feedbacks.statusCode, 200);
    assert.ok(feedbacks.json().items.some((item: { id: string }) => item.id === feedbackId));

    const reviewed = await app.inject({
      method: 'PATCH',
      url: `/api/admin/feedbacks/report/${feedbackId}`,
      headers,
      payload: { status: 'approved', reviewer_note: '测试审核通过' },
    });
    assert.equal(reviewed.statusCode, 200);
    const stored = await prisma.reportFeedback.findUnique({ where: { feedback_id: feedbackId } });
    assert.equal(stored?.review_status, 'approved');
    assert.equal(stored?.reviewer_note, '测试审核通过');

    const security = await app.inject({ method: 'GET', url: '/api/admin/security?days=7', headers });
    assert.equal(security.statusCode, 200);
    assert.equal(security.json().events.some((event: Record<string, unknown>) => 'ip_address' in event || 'visitor_id' in event || 'user_agent' in event), false);
    assert.ok(security.json().events.some((event: { event_type: string }) => event.event_type === 'admin_feedback_review'));
  } finally {
    await prisma.securityEvent.deleteMany({ where: { event_type: 'admin_feedback_review', created_at: { gte: startedAt } } });
    await prisma.reportFeedback.deleteMany({ where: { feedback_id: feedbackId } });
    await prisma.jobReport.deleteMany({ where: { report_id: { in: [modelReportId, fallbackReportId] } } });
    await app.close();
    await prisma.$disconnect();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
