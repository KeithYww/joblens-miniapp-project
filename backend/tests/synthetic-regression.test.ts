import assert from 'node:assert/strict';
import test from 'node:test';
import { RiskReportSchema } from '../src/schemas';
import { RuleBasedProvider } from '../src/services/llm';
import type { RiskReport } from '../src/types';

type Expected = {
  minScore?: number;
  maxScore?: number;
  level?: RiskReport['risk_level'];
  riskType?: string;
  forbiddenRiskType?: string;
  predictedRole?: string;
};

type SyntheticSample = {
  id: string;
  category: string;
  jd: string;
  hr?: string;
  expected: Expected;
};

const locations = ['上海', '深圳', '杭州', '成都', '武汉', '南京', '苏州', '西安'];

function makeSamples(): SyntheticSample[] {
  const samples: SyntheticSample[] = [];

  for (let index = 0; index < 8; index += 1) {
    samples.push({
      id: `transparent-sales-${index + 1}`,
      category: '正常销售岗',
      jd: `工作地点：${locations[index]}。岗位名称：销售代表。固定底薪${5000 + index * 200}元，提成比例10%-20%。职责：开发客户、维护客户关系并完成每月销售目标。公司提供客户线索，入职签订劳动合同并缴纳五险一金。`,
      hr: '固定底薪和提成会写入 offer，每月销售目标十万元，未完成不会扣固定底薪。',
      expected: { maxScore: 30, level: '低', forbiddenRiskType: '管理岗包装销售岗', predictedRole: '销售岗' },
    });
  }

  for (let index = 0; index < 8; index += 1) {
    samples.push({
      id: `management-wrapper-${index + 1}`,
      category: '管理岗包装销售岗',
      jd: `工作地点：${locations[index]}。岗位名称：储备主管。职责包括市场实践、客户开发、业绩跟进和培养管理人才，完成实作期考核后参与团队管理。`,
      hr: '个人销售指标和固定无责底薪具体到公司详细介绍，面试时说明。',
      expected: { minScore: 70, level: '高', riskType: '管理岗包装销售岗', predictedRole: '销售/客户开发岗' },
    });
  }

  for (let index = 0; index < 6; index += 1) {
    samples.push({
      id: `training-loan-${index + 1}`,
      category: '培训贷',
      jd: `岗位名称：Java开发助理。零经验可培养，入职前参加培训，培训费用${12000 + index * 1000}元，可由合作机构办理培训贷或贷款分期，培训通过后安排项目。`,
      hr: '费用需要求职者承担，贷款办理完成后才能开始培训。',
      expected: { minScore: 81, level: '极高', riskType: '涉及贷款' },
    });
  }

  for (let index = 0; index < 6; index += 1) {
    samples.push({
      id: `upfront-fee-${index + 1}`,
      category: '入职收费',
      jd: `岗位名称：商务助理。月薪8-12K，录用后需先交费${500 + index * 100}元作为工装押金或岗位保证金，工作满三个月退还。`,
      expected: { minScore: 80, level: '极高', riskType: '涉及收费' },
    });
  }

  for (let index = 0; index < 4; index += 1) {
    samples.push({
      id: `document-retention-${index + 1}`,
      category: '扣留证件',
      jd: `岗位名称：现场管理员。办理入职时公司会扣身份证或扣毕业证原件，项目结束后统一归还。工作地点：${locations[index]}。`,
      expected: { minScore: 81, level: '极高', riskType: '扣留证件风险' },
    });
  }

  for (let index = 0; index < 4; index += 1) {
    samples.push({
      id: `unpaid-trial-${index + 1}`,
      category: '无薪试岗',
      jd: `岗位名称：内容运营。正式录用前需要完成${3 + index}天无薪试岗，通过后签订劳动合同，试岗期间每天工作八小时。`,
      expected: { minScore: 75, level: '高', riskType: '无薪试岗' },
    });
  }

  for (let index = 0; index < 4; index += 1) {
    samples.push({
      id: `network-recruiting-${index + 1}`,
      category: '亲友资源',
      jd: `岗位名称：业务合伙人。新人考核要求拉亲友资源，邀请至少${5 + index}名亲友参加产品说明会并完成意向登记。`,
      expected: { minScore: 70, level: '高', riskType: '拉亲友资源' },
    });
  }

  for (let index = 0; index < 5; index += 1) {
    samples.push({
      id: `insufficient-${index + 1}`,
      category: '信息不足',
      jd: `岗位名称：${['专员', '助理', '文员', '顾问', '储备人员'][index]}。薪资面议，岗位职责待定，具体安排另行通知。`,
      expected: { maxScore: 30, level: '低' },
    });
  }

  for (let index = 0; index < 5; index += 1) {
    samples.push({
      id: `transparent-professional-${index + 1}`,
      category: '正常专业岗',
      jd: `工作地点：${locations[index]}。岗位名称：${['前端工程师', '会计', '行政专员', '测试工程师', '产品设计师'][index]}。月薪${10 + index}-${15 + index}K。职责包括完成本岗位日常交付、跨部门协作和文档维护。要求两年以上相关经验。入职签订劳动合同，试用期三个月，缴纳五险一金，周末双休。`,
      hr: '薪资范围为固定税前月薪，劳动合同和社保均由招聘主体签订与缴纳，不收取任何费用。',
      expected: { maxScore: 30, level: '低' },
    });
  }

  assert.equal(samples.length, 50);
  return samples;
}

test('50 synthetic job samples meet the frozen regression expectations', async () => {
  const provider = new RuleBasedProvider();
  const failures: string[] = [];

  for (const sample of makeSamples()) {
    const result = await provider.analyzeJobRisk({ jd_text: sample.jd, hr_chat_text: sample.hr });
    const parsed = RiskReportSchema.safeParse(result.parsedJson);
    if (!parsed.success) {
      failures.push(`${sample.id}: schema invalid: ${parsed.error.issues[0]?.message}`);
      continue;
    }

    const report = parsed.data;
    const expected = sample.expected;
    if (expected.minScore !== undefined && report.overall_score < expected.minScore) {
      failures.push(`${sample.id}: score ${report.overall_score} < ${expected.minScore}`);
    }
    if (expected.maxScore !== undefined && report.overall_score > expected.maxScore) {
      failures.push(`${sample.id}: score ${report.overall_score} > ${expected.maxScore}`);
    }
    if (expected.level !== undefined && report.risk_level !== expected.level) {
      failures.push(`${sample.id}: level ${report.risk_level} != ${expected.level}`);
    }
    if (expected.riskType && !report.risk_types.includes(expected.riskType)) {
      failures.push(`${sample.id}: missing risk type ${expected.riskType}`);
    }
    if (expected.forbiddenRiskType && report.risk_types.includes(expected.forbiddenRiskType)) {
      failures.push(`${sample.id}: forbidden risk type ${expected.forbiddenRiskType}`);
    }
    if (expected.predictedRole && report.predicted_role !== expected.predictedRole) {
      failures.push(`${sample.id}: predicted role ${report.predicted_role} != ${expected.predictedRole}`);
    }

    const outputText = [report.recommendation, ...report.evidence].join('\n');
    assert.doesNotMatch(outputText, /骗子|诈骗|欺诈|黑公司|烂公司|实锤|铁证|肯定是|绝对是/);
  }

  const failedSampleCount = new Set(failures.map(failure => failure.split(':', 1)[0])).size;
  const passRate = (50 - failedSampleCount) / 50;
  assert.ok(passRate >= 0.95, `synthetic regression pass rate ${(passRate * 100).toFixed(1)}% is below 95%:\n${failures.join('\n')}`);
});
