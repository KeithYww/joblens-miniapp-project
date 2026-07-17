import assert from 'node:assert/strict';
import test from 'node:test';
import { RiskReportSchema } from '../src/schemas';
import { RuleBasedProvider } from '../src/services/llm';
import { localizeReportText } from '../src/routes';

type Sample = {
  id: string;
  jd: string;
  hr?: string;
  min?: number;
  max?: number;
  level?: '低' | '中' | '高' | '极高';
  type?: string;
  forbidden?: string;
};

function samples(): Sample[] {
  const data: Sample[] = [];
  for (let i = 0; i < 5; i += 1) {
    data.push({
      id: `en-transparent-sales-${i + 1}`,
      jd: `Sales Representative in City ${i + 1}. Fixed base salary USD ${4000 + i * 200} per month plus 10% commission. Responsibilities include prospecting, account management, and a written monthly sales target. Full-time employment contract, health insurance, and paid leave are provided.`,
      hr: 'The base salary and commission will be written in the offer. No fee, deposit, or purchase is required.',
      max: 30,
      level: '低',
      forbidden: '管理岗包装销售岗',
    });
  }
  for (let i = 0; i < 4; i += 1) {
    data.push({
      id: `en-management-wrapper-${i + 1}`,
      jd: `Management Trainee. Begin with field marketing, client acquisition, lead generation and performance targets before becoming a team manager. Fast promotion is available after the practical assessment.`,
      hr: 'The individual sales quota and guaranteed base salary will be explained at the interview and cannot be disclosed now.',
      min: 70,
      level: '高',
      type: '管理岗包装销售岗',
    });
  }
  for (let i = 0; i < 4; i += 1) {
    data.push({
      id: `en-training-loan-${i + 1}`,
      jd: `Junior Software Developer. No experience required. Before placement, candidates must complete a bootcamp costing USD ${3000 + i * 500}. The company arranges a training loan with monthly loan installments. Employment is considered after training.`,
      min: 81,
      level: '极高',
      type: '涉及贷款',
    });
  }
  for (let i = 0; i < 3; i += 1) {
    data.push({
      id: `en-upfront-fee-${i + 1}`,
      jd: `Remote Administrative Assistant. Candidates must pay an upfront fee of USD ${200 + i * 50} as a refundable security deposit before receiving equipment and starting work.`,
      min: 80,
      level: '高',
      type: '涉及收费',
    });
  }
  for (let i = 0; i < 2; i += 1) {
    data.push({
      id: `en-passport-retention-${i + 1}`,
      jd: `Overseas Site Coordinator. The employer will retain passport originals during the ${6 + i}-month project and return them after the assignment ends.`,
      min: 81,
      level: '极高',
      type: '扣留证件风险',
    });
  }
  for (let i = 0; i < 2; i += 1) {
    data.push({
      id: `en-insufficient-${i + 1}`,
      jd: `Job title: Assistant ${i + 1}. Pay negotiable. Duties and employer details to be discussed later.`,
      max: 30,
      level: '低',
    });
  }
  assert.equal(data.length, 20);
  return data;
}

test('20 English synthetic samples meet regression expectations', async () => {
  const provider = new RuleBasedProvider();
  const failures: string[] = [];
  for (const sample of samples()) {
    const result = await provider.analyzeJobRisk({ jd_text: sample.jd, hr_chat_text: sample.hr, language: 'en-US' });
    const parsed = RiskReportSchema.safeParse(result.parsedJson);
    if (!parsed.success) {
      failures.push(`${sample.id}: invalid schema`);
      continue;
    }
    const report = parsed.data;
    if (sample.min !== undefined && report.overall_score < sample.min) failures.push(`${sample.id}: score ${report.overall_score} < ${sample.min}`);
    if (sample.max !== undefined && report.overall_score > sample.max) failures.push(`${sample.id}: score ${report.overall_score} > ${sample.max}`);
    if (sample.level && report.risk_level !== sample.level) failures.push(`${sample.id}: level ${report.risk_level} != ${sample.level}`);
    if (sample.type && !report.risk_types.includes(sample.type)) failures.push(`${sample.id}: missing ${sample.type}`);
    if (sample.forbidden && report.risk_types.includes(sample.forbidden)) failures.push(`${sample.id}: forbidden ${sample.forbidden}`);
  }
  const failed = new Set(failures.map(item => item.split(':', 1)[0])).size;
  const passRate = (20 - failed) / 20;
  assert.ok(passRate >= 0.95, `English pass rate ${(passRate * 100).toFixed(1)}% is below 95%:\n${failures.join('\n')}`);
});

test('rule-generated evidence is fully localized for English reports', () => {
  const evidence = [
    '岗位文本明确提到培训贷，需要求职者承担相关费用。',
    '岗位文本明确提到扣身份证，存在证件原件被留存的风险。',
    '岗位文本明确提到押金，入职前需要核实收费依据。',
    '岗位文本明确提到无薪试岗，需要在接受岗位前核实具体安排。',
  ];
  for (const item of evidence) {
    const localized = localizeReportText(item);
    assert.notEqual(localized, item);
    assert.doesNotMatch(localized, /[\u3400-\u9fff]/);
  }
});
