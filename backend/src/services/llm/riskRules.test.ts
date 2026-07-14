import assert from 'node:assert/strict';
import test from 'node:test';
import type { RiskReport } from '../../types';
import { applyAllRules } from './index';

function report(score = 45): RiskReport {
  return {
    report_id: 'rep_123456abcdef',
    overall_score: score,
    risk_level: score > 60 ? '高' : '中',
    confidence: '中',
    predicted_role: null,
    risk_types: ['信息不完整'],
    sub_scores: {
      jd_risk: { score, weight: 0.35, status: 'available' },
      hr_risk: { score: null, weight: 0.2, status: 'missing' },
      company_risk: { score: null, weight: 0.25, status: 'missing' },
      feedback_risk: { score: null, weight: 0.2, status: 'missing' },
    },
    strong_risk_adjustment: 0,
    evidence: [],
    missing_info: [],
    questions: [],
    recommendation: '建议补充更多信息后确认。',
    disclaimer: '本结果仅供求职决策参考，不构成法律认定。',
    created_at: new Date().toISOString(),
  };
}

test('does not mark a transparent sales job as management-role packaging', () => {
  const output = applyAllRules(
    report(55),
    '岗位名称：销售代表。底薪5000元加提成，提成比例10%-20%，职责是开发客户并完成销售目标。',
    '底薪5000元，提成比例10%-20%，每月销售目标10万元，不会扣底薪。'
  );
  assert.equal(output.risk_types.includes('管理岗包装销售岗'), false);
});

test('raises management-role packaging with multiple concealed sales duties', () => {
  const output = applyAllRules(
    report(45),
    '岗位名称：储备主管。职责包括市场实践、业绩跟进和培养管理人才。',
    '销售指标和固定无责底薪具体到公司会详细介绍，面试时说明。'
  );
  assert.equal(output.risk_level, '高');
  assert.ok(output.overall_score >= 70);
  assert.equal(output.predicted_role, '销售/客户开发岗');
  assert.equal(output.risk_types.includes('管理岗包装销售岗'), true);
});

test('flags pension-business management assistant roles with high pay and vague duties for verification', () => {
  const output = applyAllRules(
    report(42),
    '纯外企 16薪 养老事业部辅助管理（急招）。上海30-60K，16薪，1-3年，大专。职责：了解负责部门日常管理作业流程，处理相关表单的管理能力；具备沟通协调能力。'
  );
  assert.equal(output.risk_level, '高');
  assert.ok(output.overall_score >= 65);
  assert.equal(output.risk_types.includes('岗位职责与薪资不匹配'), true);
  assert.equal(output.risk_types.includes('疑似业务性质需确认'), true);
  assert.match(output.questions.join('\n'), /保险或金融产品/);
  assert.match(output.questions.join('\n'), /固定无责底薪/);
});

test('treats training loans as critical risk', () => {
  const output = applyAllRules(
    report(55),
    '入职前需参加培训，培训费用可以申请贷款分期。'
  );
  assert.equal(output.risk_level, '极高');
  assert.ok(output.overall_score >= 81);
  assert.equal(output.risk_types.includes('涉及贷款'), true);
});

test('downgrades short job text without strong signals to insufficient information', () => {
  const output = applyAllRules(report(58), '岗位名称：专员，薪资面议，职责待定。');
  assert.equal(output.risk_level, '低');
  assert.equal(output.confidence, '低');
  assert.ok(output.overall_score <= 30);
  assert.deepEqual(output.risk_types, []);
});
