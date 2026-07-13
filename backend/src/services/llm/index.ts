import type { RiskReport, HrAnalysis, LlmProviderResult } from '@/types';
import { RiskReportSchema, HrAnalysisSchema } from '@/schemas';
import { z } from 'zod';
import { SiliconFlowProvider } from './siliconflow';
import { QwenCloudProvider } from './qwencloud';

interface LlmProvider {
  name: string;
  analyzeJobRisk(input: {
    source_platform?: string;
    company_name?: string;
    job_title?: string;
    jd_text: string;
    hr_chat_text?: string;
  }): Promise<LlmProviderResult>;
  analyzeHrReply(input: {
    report_id?: string;
    user_question: string;
    hr_reply: string;
    jd_context?: string;
  }): Promise<LlmProviderResult>;
}

const STRONG_RISK_WORDS = [
  '押金', '保证金', '培训贷', '贷款分期', '扣身份证', '扣毕业证', '先交费', '拉亲友资源', '无薪试岗',
];

const SENSITIVE_EXPRESSIONS: Record<string, string> = {
  '骗子': '信息不透明',
  '诈骗': '信息不透明',
  '欺诈': '信息不透明',
  '黑公司': '公司信息不完整',
  '烂公司': '公司信息不完整',
  '实锤': '存在明显信号',
  '铁证': '存在明显信号',
  '肯定是': '可能是',
  '绝对是': '可能是',
  '拉人头': '存在类似特征',
  '传销': '存在类似特征',
  '洗脑': '培训方式存疑',
  'PUA': '培训方式存疑',
};

function filterSensitiveExpressions(text: string): string {
  let result = text;
  for (const [bad, good] of Object.entries(SENSITIVE_EXPRESSIONS)) {
    result = result.replace(new RegExp(bad, 'g'), good);
  }
  return result;
}

function calculateRiskLevel(score: number): '低' | '中' | '高' | '极高' {
  if (score <= 30) return '低';
  if (score <= 60) return '中';
  if (score <= 80) return '高';
  return '极高';
}

function calculateConfidence(subScores: RiskReport['sub_scores']): '高' | '中' | '低' {
  const availableCount = Object.values(subScores).filter(s => s.status === 'available').length;
  if (availableCount >= 3) return '高';
  if (availableCount >= 2) return '中';
  return '低';
}

function convertMissingToQuestions(missingInfo: string[]): string[] {
  return missingInfo.map(info => {
    const question = `${info}是多少？是否可以提供书面说明？`;
    return question.substring(0, 100);
  });
}

function checkStrongRiskWords(text: string): { found: boolean; words: string[] } {
  const foundWords = STRONG_RISK_WORDS.filter(word => text.includes(word));
  return { found: foundWords.length > 0, words: foundWords };
}

function applyStrongRiskCorrection(report: RiskReport, jdText: string, hrChatText?: string): RiskReport {
  const allText = `${jdText} ${hrChatText || ''}`;
  const { found, words } = checkStrongRiskWords(allText);
  
  if (!found) return report;

  let adjustment = report.strong_risk_adjustment;
  let newEvidence = [...report.evidence];
  
  for (const word of words) {
    if (word === '培训贷' || word === '贷款分期') {
      adjustment += 10;
      newEvidence.push(`岗位涉及${word}`);
    } else if (word === '扣身份证' || word === '扣毕业证') {
      adjustment += 10;
      newEvidence.push(`岗位涉及${word}`);
    } else if (word === '无薪试岗') {
      adjustment += 5;
      newEvidence.push(`岗位涉及${word}`);
    } else if (word === '押金' || word === '保证金' || word === '先交费') {
      adjustment += 5;
      newEvidence.push(`岗位涉及${word}`);
    } else if (word === '拉亲友资源') {
      adjustment += 8;
      newEvidence.push(`岗位涉及${word}`);
    }
  }
  
  adjustment = Math.min(adjustment, 20);
  
  let newScore = report.overall_score + adjustment;
  newScore = Math.min(newScore, 100);
  
  return {
    ...report,
    overall_score: newScore,
    risk_level: calculateRiskLevel(newScore),
    strong_risk_adjustment: adjustment,
    evidence: [...new Set(newEvidence)],
  };
}

function applyEvidenceValidation(report: RiskReport): RiskReport {
  if (report.overall_score >= 60 && report.evidence.length === 0) {
    return {
      ...report,
      overall_score: 45,
      risk_level: '中',
      confidence: '低',
      recommendation: '信息不足以判断，建议补充岗位详情或 HR 聊天记录后重新检测。',
      evidence: ['当前输入信息不足以生成明确风险结论。'],
    };
  }
  return report;
}

function applyAntiMisjudgmentRules(report: RiskReport, jdText: string): RiskReport {
  if (jdText.includes('销售') && jdText.includes('底薪') && jdText.includes('提成')) {
    if (report.risk_types.includes('管理岗包装销售岗')) {
      const newRiskTypes = report.risk_types.filter(t => t !== '管理岗包装销售岗');
      if (report.overall_score > 50) {
        return {
          ...report,
          overall_score: Math.max(30, report.overall_score - 20),
          risk_level: calculateRiskLevel(Math.max(30, report.overall_score - 20)),
          risk_types: newRiskTypes.length > 0 ? newRiskTypes : [],
          predicted_role: '销售岗',
        };
      }
    }
  }
  
  if (jdText.length < 100) {
    return {
      ...report,
      confidence: '低',
      overall_score: Math.min(report.overall_score, 60),
      risk_level: calculateRiskLevel(Math.min(report.overall_score, 60)),
    };
  }
  
  return report;
}

function applyAllRules(report: RiskReport, jdText: string, hrChatText?: string): RiskReport {
  let result = report;
  
  result = applyStrongRiskCorrection(result, jdText, hrChatText);
  result = applyEvidenceValidation(result);
  result = applyAntiMisjudgmentRules(result, jdText);
  
  result.recommendation = filterSensitiveExpressions(result.recommendation);
  result.evidence = result.evidence.map(e => filterSensitiveExpressions(e));
  
  result.confidence = calculateConfidence(result.sub_scores);
  
  if (result.questions.length === 0) {
    result.questions = convertMissingToQuestions(result.missing_info);
  }
  
  return result;
}

class RuleBasedProvider implements LlmProvider {
  name = 'rule-based';

  analyzeJobRisk(input: {
    source_platform?: string;
    company_name?: string;
    job_title?: string;
    jd_text: string;
    hr_chat_text?: string;
  }): Promise<LlmProviderResult> {
    const jd = input.jd_text.toLowerCase();
    
    let score = 45;
    let riskTypes: string[] = [];
    let evidence: string[] = [];
    let missingInfo: string[] = ['固定无责底薪', '劳动合同主体', '社保缴纳主体'];
    let predictedRole: string | null = null;
    
    if (jd.includes('储备') && jd.includes('管理') && !jd.includes('销售')) {
      score = 72;
      riskTypes = ['管理岗包装销售岗', '薪资不透明'];
      evidence = [
        'JD中出现"储备、管理"等表述，可能存在岗位包装',
        '未明确说明薪资构成和销售指标',
      ];
      predictedRole = '销售/客户开发岗';
      missingInfo.push('是否有个人销售指标');
    } else if (jd.includes('销售')) {
      if (jd.includes('底薪') && jd.includes('提成')) {
        score = 25;
        riskTypes = [];
        evidence = [];
        predictedRole = '销售岗';
      } else {
        score = 55;
        riskTypes = ['薪资不透明'];
        evidence = ['未明确说明底薪和提成构成'];
      }
    } else if (jd.includes('培训') && jd.includes('费用')) {
      score = 85;
      riskTypes = ['涉及贷款'];
      evidence = ['JD中提到培训费用，可能涉及培训贷'];
      predictedRole = '培训贷风险';
    } else if (jd.includes('押金') || jd.includes('保证金')) {
      score = 80;
      riskTypes = ['涉及收费'];
      evidence = ['JD中提到押金或保证金'];
    } else if (jd.length < 100) {
      score = 35;
      riskTypes = [];
      evidence = [];
    }
    
    const report: RiskReport = {
      report_id: `rep_${Math.random().toString(36).slice(2, 14)}`,
      overall_score: score,
      risk_level: calculateRiskLevel(score),
      confidence: '中',
      predicted_role: predictedRole,
      risk_types: riskTypes,
      sub_scores: {
        jd_risk: { score: score * 0.8, weight: 0.35, status: 'available' },
        hr_risk: input.hr_chat_text ? { score: 50, weight: 0.20, status: 'available' } : { score: null, weight: 0.20, status: 'missing' },
        company_risk: { score: null, weight: 0.25, status: 'missing' },
        feedback_risk: { score: null, weight: 0.20, status: 'missing' },
      },
      strong_risk_adjustment: 0,
      evidence: evidence,
      missing_info: missingInfo,
      questions: convertMissingToQuestions(missingInfo),
      recommendation: score >= 60
        ? '建议先电话确认核心问题，不建议直接线下面试。'
        : '该岗位风险较低，建议正常面试。',
      disclaimer: '本结果仅供求职决策参考，不构成法律认定。',
      created_at: new Date().toISOString(),
    };
    
    const processedReport = applyAllRules(report, input.jd_text, input.hr_chat_text);
    
    const jsonString = JSON.stringify(processedReport);
    
    return Promise.resolve({
      rawText: jsonString,
      parsedJson: processedReport,
      model: 'mock-model',
      provider: 'mock',
      inputTokens: input.jd_text.length * 2,
      outputTokens: jsonString.length * 2,
      latencyMs: 500,
      costEstimate: 0,
    });
  }

  analyzeHrReply(input: {
    report_id?: string;
    user_question: string;
    hr_reply: string;
    jd_context?: string;
  }): Promise<LlmProviderResult> {
    const reply = input.hr_reply.toLowerCase();
    
    let avoidanceScore = 50;
    let riskLevel: '低' | '中' | '高' | '极高' = '中';
    let analysis = 'HR回复较为正常，未发现明显回避。';
    let nextQuestions: string[] = [];
    
    if (reply.includes('具体') && reply.includes('公司') && reply.includes('介绍')) {
      avoidanceScore = 86;
      riskLevel = '高';
      analysis = 'HR未正面回答问题，使用"到公司详细介绍"等表述回避。';
      nextQuestions = [
        '是否有个人销售指标？',
        '客户来源由公司提供，还是需要自己开发？',
      ];
    } else if (reply.includes('稍后') || reply.includes('面试时')) {
      avoidanceScore = 65;
      riskLevel = '中';
      analysis = 'HR将关键信息推迟到面试时说明，建议提前确认。';
      nextQuestions = ['能否提前告知相关信息？'];
    } else if (reply.includes('保密') || reply.includes('不便透露')) {
      avoidanceScore = 75;
      riskLevel = '高';
      analysis = 'HR以保密为由拒绝回答，建议谨慎对待。';
      nextQuestions = ['该信息对求职决策很重要，能否简要说明？'];
    }
    
    const hrAnalysis: HrAnalysis = {
      hr_analysis_id: `hra_${Math.random().toString(36).slice(2, 14)}`,
      report_id: input.report_id,
      avoidance_score: avoidanceScore,
      risk_level: riskLevel,
      analysis: analysis,
      next_questions: nextQuestions,
      created_at: new Date().toISOString(),
    };
    
    const jsonString = JSON.stringify(hrAnalysis);
    
    return Promise.resolve({
      rawText: jsonString,
      parsedJson: hrAnalysis,
      model: 'mock-model',
      provider: 'mock',
      inputTokens: input.user_question.length + input.hr_reply.length * 2,
      outputTokens: jsonString.length * 2,
      latencyMs: 300,
      costEstimate: 0,
    });
  }
}

export { LlmProvider, RuleBasedProvider, applyAllRules, applyEvidenceValidation, applyStrongRiskCorrection, applyAntiMisjudgmentRules };
export { SiliconFlowProvider } from './siliconflow';
export { QwenCloudProvider } from './qwencloud';

export function createLlmProvider(): LlmProvider {
  const providerType = process.env.AI_PROVIDER || 'rule-based';
  
  switch (providerType) {
    case 'siliconflow':
      return new SiliconFlowProvider();
    case 'qwen-cloud':
      return new QwenCloudProvider();
    case 'rule-based':
    case 'mock':
    default:
      return new RuleBasedProvider();
  }
}

export class FallbackLlmProvider implements LlmProvider {
  name = 'fallback';
  private primary: LlmProvider;
  private fallback: LlmProvider;
  private primaryFailed = false;

  constructor(primary: LlmProvider, fallback: LlmProvider) {
    this.primary = primary;
    this.fallback = fallback;
  }

  async analyzeJobRisk(input: Parameters<LlmProvider['analyzeJobRisk']>[0]): Promise<LlmProviderResult> {
    if (!this.primaryFailed) {
      try {
        const result = await this.primary.analyzeJobRisk(input);
        return result;
      } catch (err) {
        console.warn(`Primary provider ${this.primary.name} failed, falling back to rule-based:`, (err as Error).message);
        this.primaryFailed = true;
      }
    }
    const result = await this.fallback.analyzeJobRisk(input);
    result.provider = `fallback(${this.primary.name})`;
    return result;
  }

  async analyzeHrReply(input: Parameters<LlmProvider['analyzeHrReply']>[0]): Promise<LlmProviderResult> {
    if (!this.primaryFailed) {
      try {
        const result = await this.primary.analyzeHrReply(input);
        return result;
      } catch (err) {
        console.warn(`Primary provider ${this.primary.name} failed, falling back to rule-based:`, (err as Error).message);
        this.primaryFailed = true;
      }
    }
    const result = await this.fallback.analyzeHrReply(input);
    result.provider = `fallback(${this.primary.name})`;
    return result;
  }
}

export function createLlmProviderWithFallback(): LlmProvider {
  const primary = createLlmProvider();
  if (primary.name === 'rule-based') {
    return primary;
  }
  const fallback = new RuleBasedProvider();
  return new FallbackLlmProvider(primary, fallback);
}
