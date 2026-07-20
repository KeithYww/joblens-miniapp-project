import assert from 'node:assert/strict';
import test from 'node:test';

test('AI switch fails closed for OCR and degrades text analysis to rules', { timeout: 30_000 }, async () => {
  const previous = {
    AI_CALLS_ENABLED: process.env.AI_CALLS_ENABLED,
    REQUIRE_DATABASE: process.env.REQUIRE_DATABASE,
    REQUIRE_REDIS: process.env.REQUIRE_REDIS,
  };
  process.env.AI_CALLS_ENABLED = 'false';
  process.env.REQUIRE_DATABASE = 'false';
  process.env.REQUIRE_REDIS = 'false';

  const { createServer } = await import('../src/index');
  const app = await createServer();
  const visitorId = 'visitor_1234567890abcdef1234567890abcdef';
  try {
    const quota = await app.inject({ method: 'GET', url: '/api/ai-quota', headers: { 'x-visitor-id': visitorId } });
    assert.equal(quota.statusCode, 200);
    assert.equal(quota.json().available, false);

    const report = await app.inject({
      method: 'POST',
      url: '/api/reports/detect',
      headers: { 'x-visitor-id': visitorId },
      payload: { jd_text: '招聘运营管理岗位，负责部门流程、客户沟通和表单管理，薪资结构、固定底薪及具体业务边界需要进一步确认。' },
    });
    assert.equal(report.statusCode, 200);
    assert.equal(report.headers['x-joblens-analysis-source'], 'fallback');
    assert.equal(report.json().analysis_source, 'fallback');

    const englishReport = await app.inject({
      method: 'POST',
      url: '/api/reports/detect',
      headers: { 'x-visitor-id': 'visitor_abcdef1234567890abcdef1234567890' },
      payload: {
        jd_text: '招聘运营管理岗位，负责部门流程、客户沟通和表单管理，薪资结构、固定底薪及具体业务边界需要进一步确认。',
        language: 'en-US',
      },
    });
    assert.equal(englishReport.statusCode, 200);
    const englishBody = englishReport.json();
    assert.equal(englishBody.analysis_source, 'fallback');
    assert.match(englishBody.risk_level, /^(低|中|高|极高)$/);
    assert.match(englishBody.confidence, /^(低|中|高)$/);
    assert.doesNotMatch(JSON.stringify({
      predicted_role: englishBody.predicted_role,
      risk_types: englishBody.risk_types,
      evidence: englishBody.evidence,
      missing_info: englishBody.missing_info,
      questions: englishBody.questions,
      recommendation: englishBody.recommendation,
      disclaimer: englishBody.disclaimer,
    }), /\p{Script=Han}/u);

    const reloadedEnglishReport = await app.inject({
      method: 'GET',
      url: `/api/reports/${englishBody.report_id}?language=en-US`,
      headers: { 'x-visitor-id': 'visitor_abcdef1234567890abcdef1234567890' },
    });
    assert.equal(reloadedEnglishReport.statusCode, 200);
    assert.doesNotMatch(JSON.stringify({
      predicted_role: reloadedEnglishReport.json().predicted_role,
      risk_types: reloadedEnglishReport.json().risk_types,
      evidence: reloadedEnglishReport.json().evidence,
      missing_info: reloadedEnglishReport.json().missing_info,
      questions: reloadedEnglishReport.json().questions,
      recommendation: reloadedEnglishReport.json().recommendation,
      disclaimer: reloadedEnglishReport.json().disclaimer,
    }), /\p{Script=Han}/u);

    const ocr = await app.inject({
      method: 'POST',
      url: '/api/ocr/extract-job',
      headers: { 'x-visitor-id': visitorId },
      payload: { images: [ONE_PIXEL_PNG] },
    });
    assert.equal(ocr.statusCode, 503);
    assert.equal(ocr.json().error, 'AI_DISABLED');
  } finally {
    await app.close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

const ONE_PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
