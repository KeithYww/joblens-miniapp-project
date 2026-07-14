import '../../config/env';
import type { RiskReport, HrAnalysis, LlmProviderResult } from '../../types';
import { SiliconFlowProvider } from './siliconflow';
import { QwenCloudProvider } from './qwencloud';
import { safeProviderError } from './common';

interface LlmProvider {
  name: string;
  analyzeJobRisk(input: {
    source_platform?: string;
    company_name?: string;
    job_title?: string;
    jd_text: string;
    hr_chat_text?: string;
    language?: 'zh-CN' | 'en-US';
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
const MANAGEMENT_WRAPPER_WORDS = ['储备主管', '储备管理', '管理培训生', '管理岗', '储备干部'];
const SALES_DUTY_WORDS = ['市场实践', '业绩跟进', '客户开发', '拓展客户', '拉新', '陌拜', '地推'];
const PENSION_BUSINESS_WORDS = ['养老事业部', '养老业务部', '保险事业部', '金融事业部'];

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

function hasHighSalaryRange(text: string): boolean {
  return /(?:2[5-9]|[3-9]\d)\s*(?:[-~～至]\s*(?:[3-9]\d|1\d{2}))?\s*[kK]/.test(text);
}

function applyStrongRiskCorrection(report: RiskReport, jdText: string, hrChatText?: string): RiskReport {
  const allText = `${jdText} ${hrChatText || ''}`;
  const { found, words } = checkStrongRiskWords(allText);
  
  if (!found) return report;

  let adjustment = report.strong_risk_adjustment;
  const newEvidence = [...report.evidence];
  const riskTypes = [...report.risk_types];
  const hasLoan = words.some(word => word === '培训贷' || word === '贷款分期');
  const hasDocumentRetention = words.some(word => word === '扣身份证' || word === '扣毕业证');
  const hasUpfrontFee = words.some(word => word === '押金' || word === '保证金' || word === '先交费');
  const hasUnpaidTrial = words.includes('无薪试岗');
  const hasNetworkRecruiting = words.includes('拉亲友资源');

  if (hasLoan) {
    adjustment = Math.max(adjustment, 20);
    newEvidence.push(`岗位涉及${words.find(word => word === '培训贷' || word === '贷款分期')}`);
    riskTypes.push('涉及贷款');
  } else if (hasDocumentRetention) {
    adjustment = Math.max(adjustment, 20);
    newEvidence.push(`岗位涉及${words.find(word => word === '扣身份证' || word === '扣毕业证')}`);
    riskTypes.push('扣留证件风险');
  } else if (hasUpfrontFee) {
    adjustment = Math.max(adjustment, 20);
    newEvidence.push(`岗位涉及${words.find(word => word === '押金' || word === '保证金' || word === '先交费')}`);
    riskTypes.push('涉及收费');
  } else if (hasUnpaidTrial || hasNetworkRecruiting) {
    adjustment = Math.max(adjustment, 15);
    newEvidence.push(`岗位涉及${words[0]}`);
    riskTypes.push(hasUnpaidTrial ? '无薪试岗' : '拉亲友资源');
  }

  let newScore = Math.min(report.overall_score + adjustment, 100);
  if (hasLoan || hasDocumentRetention) newScore = Math.max(newScore, 81);
  else if (hasUpfrontFee) newScore = Math.max(newScore, 80);
  
  return {
    ...report,
    overall_score: newScore,
    risk_level: calculateRiskLevel(newScore),
    strong_risk_adjustment: adjustment,
    evidence: [...new Set(newEvidence)],
    risk_types: [...new Set(riskTypes)],
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

function applyAntiMisjudgmentRules(report: RiskReport, jdText: string, hrChatText?: string): RiskReport {
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
  
  const hasManagementTitle = MANAGEMENT_WRAPPER_WORDS.some(word => jdText.includes(word));
  const hasExplicitSalesTitle = /销售|客户经理|业务员/.test(jdText);
  const salesDutyWords = SALES_DUTY_WORDS.filter(word => jdText.includes(word));
  const hrAvoidsKeyQuestions = /具体到公司|面试时说明|到公司详细|不便透露/.test(hrChatText || '');
  if (hasManagementTitle && !hasExplicitSalesTitle && salesDutyWords.length >= 2) {
    const score = Math.max(report.overall_score, hrAvoidsKeyQuestions ? 70 : 65);
    return {
      ...report,
      overall_score: score,
      risk_level: calculateRiskLevel(score),
      risk_types: [...new Set([...report.risk_types, '管理岗包装销售岗'])],
      evidence: [...new Set([...report.evidence, `岗位包含${salesDutyWords.join('、')}等销售职责`])],
      predicted_role: '销售/客户开发岗',
      missing_info: [...new Set([...report.missing_info, '是否有个人销售指标', '固定无责底薪'])],
    };
  }

  const hasPensionBusiness = PENSION_BUSINESS_WORDS.some(word => jdText.includes(word));
  const hasManagementAssistantTitle = /辅助管理|管理助理|部门管理/.test(jdText);
  const hasLowExperienceBarrier = /大专|1\s*[-—至]\s*3年|1-3年/.test(jdText);
  const hasVagueAdministrativeDuties = /日常管理.*流程|表单.*管理|沟通.*协调/.test(jdText);
  if (hasPensionBusiness && hasManagementAssistantTitle && hasHighSalaryRange(jdText) && hasLowExperienceBarrier && hasVagueAdministrativeDuties) {
    const score = Math.max(report.overall_score, 65);
    const missingInfo = [
      '是否涉及保险或金融产品销售、客户开发、代理人招募',
      '固定无责底薪、提成规则与个人业绩指标',
      '招聘公司名称、劳动合同主体与社保缴纳主体',
    ];
    const questions = [
      '该岗位是否需要销售保险或金融产品、开发客户或招募代理人？请明确写入 offer。',
      '30-60K 和 16 薪中，固定无责底薪、提成及个人业绩指标分别是多少？',
      '请提供招聘公司全称、劳动合同主体和社保缴纳主体。',
    ];
    return {
      ...report,
      overall_score: score,
      risk_level: calculateRiskLevel(score),
      confidence: '低',
      risk_types: [...new Set([...report.risk_types, '岗位职责与薪资不匹配', '疑似业务性质需确认'])],
      evidence: [...new Set([
        ...report.evidence,
        '岗位名称为事业部辅助管理，但职责仅描述笼统的表单和日常管理流程',
        '标注较高薪资与16薪，但要求大专及1-3年经验，未说明固定薪资和业务边界',
      ])],
      predicted_role: '养老业务相关岗（需核实具体职责）',
      missing_info: [...new Set([...report.missing_info, ...missingInfo])],
      questions: [...new Set([...report.questions, ...questions])].slice(0, 8),
      recommendation: '岗位的薪资、职责与业务边界信息不匹配。建议先书面确认是否涉及保险/金融产品销售、客户开发或代理人招募，以及固定无责底薪和合同主体，再决定是否面试。',
    };
  }

  if (jdText.length < 100 && !checkStrongRiskWords(`${jdText} ${hrChatText || ''}`).found) {
    return {
      ...report,
      confidence: '低',
      overall_score: Math.min(report.overall_score, 30),
      risk_level: '低',
      risk_types: [],
      evidence: ['岗位信息不足，暂不作明确风险判断。'],
      recommendation: '岗位信息不足，建议补充职责、薪资构成、公司主体和 HR 回复后重新检测。',
    };
  }
  
  return report;
}

function applyAllRules(report: RiskReport, jdText: string, hrChatText?: string): RiskReport {
  let result = report;
  
  result = applyStrongRiskCorrection(result, jdText, hrChatText);
  result = applyEvidenceValidation(result);
  result = applyAntiMisjudgmentRules(result, jdText, hrChatText);
  
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
    const startTime = Date.now();
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
      model: 'rule-engine-v1',
      provider: this.name,
      latencyMs: Date.now() - startTime,
      costEstimate: 0,
    });
  }

  analyzeHrReply(input: {
    report_id?: string;
    user_question: string;
    hr_reply: string;
    jd_context?: string;
  }): Promise<LlmProviderResult> {
    const startTime = Date.now();
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
      model: 'rule-engine-v1',
      provider: this.name,
      latencyMs: Date.now() - startTime,
      costEstimate: 0,
    });
  }
}

export { LlmProvider, RuleBasedProvider, applyAllRules, applyEvidenceValidation, applyStrongRiskCorrection, applyAntiMisjudgmentRules };
export { SiliconFlowProvider } from './siliconflow';
export { QwenCloudProvider } from './qwencloud';

export function createLlmProvider(): LlmProvider {
  const providerType = (process.env.AI_PROVIDER || 'rule-based').trim().toLowerCase();
  
  switch (providerType) {
    case 'siliconflow':
      return new SiliconFlowProvider();
    case 'qwen-cloud':
    case 'qwencloud':
      return new QwenCloudProvider();
    case 'rule-based':
    case 'mock':
      return new RuleBasedProvider();
    default:
      throw new Error(`Unsupported AI_PROVIDER: ${providerType}`);
  }
}

export class FallbackLlmProvider implements LlmProvider {
  name = 'fallback';
  private readonly primary: LlmProvider;
  private readonly fallback: LlmProvider;
  private readonly failureThreshold: number;
  private readonly recoveryWindowMs: number;
  private consecutiveFailures = 0;
  private openedAt = 0;
  private halfOpenProbeInFlight = false;

  constructor(
    primary: LlmProvider,
    fallback: LlmProvider,
    options?: { failureThreshold?: number; recoveryWindowMs?: number },
  ) {
    this.primary = primary;
    this.fallback = fallback;
    this.failureThreshold = options?.failureThreshold ?? positiveInteger(process.env.AI_CIRCUIT_FAILURE_THRESHOLD, 3);
    this.recoveryWindowMs = options?.recoveryWindowMs ?? positiveInteger(process.env.AI_CIRCUIT_RECOVERY_MS, 30_000);
  }

  async analyzeJobRisk(input: Parameters<LlmProvider['analyzeJobRisk']>[0]): Promise<LlmProviderResult> {
    return this.run(
      () => this.primary.analyzeJobRisk(input),
      () => this.fallback.analyzeJobRisk(input),
    );
  }

  async analyzeHrReply(input: Parameters<LlmProvider['analyzeHrReply']>[0]): Promise<LlmProviderResult> {
    return this.run(
      () => this.primary.analyzeHrReply(input),
      () => this.fallback.analyzeHrReply(input),
    );
  }

  private canTryPrimary(): boolean {
    if (this.openedAt === 0) return true;
    if (Date.now() - this.openedAt < this.recoveryWindowMs || this.halfOpenProbeInFlight) return false;
    this.halfOpenProbeInFlight = true;
    return true;
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedAt = 0;
    this.halfOpenProbeInFlight = false;
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    this.halfOpenProbeInFlight = false;
    if (this.consecutiveFailures >= this.failureThreshold) this.openedAt = Date.now();
  }

  private async run(
    callPrimary: () => Promise<LlmProviderResult>,
    callFallback: () => Promise<LlmProviderResult>,
  ): Promise<LlmProviderResult> {
    if (this.canTryPrimary()) {
      try {
        const result = await callPrimary();
        this.recordSuccess();
        return result;
      } catch (error) {
        this.recordFailure();
        console.warn(`Primary provider ${this.primary.name} failed; using fallback`, safeProviderError(error));
      }
    }
    const result = await callFallback();
    result.provider = `fallback(${this.primary.name})->${this.fallback.name}`;
    return result;
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function createLlmProviderWithFallback(): LlmProvider {
  const primary = createLlmProvider();
  if (primary.name === 'rule-based') {
    return primary;
  }
  const fallback = new RuleBasedProvider();
  return new FallbackLlmProvider(primary, fallback);
}
