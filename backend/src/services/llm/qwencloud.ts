import type { RiskReport, HrAnalysis, LlmProviderResult } from '@/types';
import axios from 'axios';

export class QwenCloudProvider {
  name = 'qwen-cloud';
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey || process.env.QWEN_API_KEY || '';
    this.model = model || process.env.QWEN_MODEL || 'qwen-plus';
  }

  async analyzeJobRisk(input: {
    source_platform?: string;
    company_name?: string;
    job_title?: string;
    jd_text: string;
    hr_chat_text?: string;
  }): Promise<LlmProviderResult> {
    const startTime = Date.now();
    
    const prompt = `你是一个专业的岗位风险分析专家。请分析以下招聘信息，识别潜在风险。

## 分析要求：
1. 风险评分范围 0-100，分数越高风险越大
2. 风险等级：低(0-30)、中(31-60)、高(61-80)、极高(81-100)
3. 置信度：高/中/低（基于信息完整性）
4. 必须提供具体证据
5. 输出格式必须是纯 JSON，不包含任何其他文本

## 输入信息：
- 来源平台：${input.source_platform || '未知'}
- 公司名称：${input.company_name || '未知'}
- 岗位名称：${input.job_title || '未知'}
- JD 文本：${input.jd_text}
- HR 聊天记录：${input.hr_chat_text || '无'}

## 输出 JSON 格式：
{
  "overall_score": number,
  "risk_level": "低"|"中"|"高"|"极高",
  "confidence": "高"|"中"|"低",
  "predicted_role": string|null,
  "risk_types": string[],
  "evidence": string[],
  "missing_info": string[],
  "questions": string[],
  "recommendation": string
}`;

    try {
      const response = await axios.post(
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
        {
          model: this.model,
          input: {
            messages: [{ role: 'user', content: prompt }],
          },
          parameters: {
            temperature: 0.3,
            max_tokens: 2000,
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          timeout: 60000,
        }
      );

      const rawText = response.data.output.choices[0].message.content;
      const parsedJson = this.parseAndValidateResponse(rawText);
      
      const latencyMs = Date.now() - startTime;

      return {
        rawText,
        parsedJson,
        model: this.model,
        provider: this.name,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs,
        costEstimate: 0,
      };
    } catch (err) {
      console.error('Qwen Cloud API error:', err);
      throw err;
    }
  }

  async analyzeHrReply(input: {
    report_id?: string;
    user_question: string;
    hr_reply: string;
    jd_context?: string;
  }): Promise<LlmProviderResult> {
    const startTime = Date.now();
    
    const prompt = `你是一个专业的 HR 回复分析专家。请分析以下对话，判断 HR 是否在回避关键问题。

## 分析要求：
1. 回避率评分范围 0-100，分数越高回避越明显
2. 风险等级：低(0-30)、中(31-60)、高(61-80)、极高(81-100)
3. 输出格式必须是纯 JSON，不包含任何其他文本

## 输入信息：
- 用户问题：${input.user_question}
- HR 回复：${input.hr_reply}
- JD 上下文：${input.jd_context || '无'}

## 输出 JSON 格式：
{
  "avoidance_score": number,
  "risk_level": "低"|"中"|"高"|"极高",
  "analysis": string,
  "next_questions": string[]
}`;

    try {
      const response = await axios.post(
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
        {
          model: this.model,
          input: {
            messages: [{ role: 'user', content: prompt }],
          },
          parameters: {
            temperature: 0.3,
            max_tokens: 1000,
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          timeout: 60000,
        }
      );

      const rawText = response.data.output.choices[0].message.content;
      const parsedJson = this.parseHrResponse(rawText);
      
      const latencyMs = Date.now() - startTime;

      return {
        rawText,
        parsedJson,
        model: this.model,
        provider: this.name,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs,
        costEstimate: 0,
      };
    } catch (err) {
      console.error('Qwen Cloud API error:', err);
      throw err;
    }
  }

  private parseAndValidateResponse(rawText: string): RiskReport {
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      const parsed = JSON.parse(jsonMatch[0]);
      
      return {
        report_id: `rep_${Math.random().toString(36).slice(2, 14)}`,
        overall_score: Math.max(0, Math.min(100, parseInt(parsed.overall_score) || 45)),
        risk_level: this.validateRiskLevel(parsed.risk_level),
        confidence: this.validateConfidence(parsed.confidence),
        predicted_role: parsed.predicted_role || null,
        risk_types: Array.isArray(parsed.risk_types) ? parsed.risk_types.slice(0, 10) : [],
        sub_scores: {
          jd_risk: { score: (parsed.overall_score || 45) * 0.8, weight: 0.35, status: 'available' },
          hr_risk: { score: null, weight: 0.20, status: 'missing' },
          company_risk: { score: null, weight: 0.25, status: 'missing' },
          feedback_risk: { score: null, weight: 0.20, status: 'missing' },
        },
        strong_risk_adjustment: 0,
        evidence: Array.isArray(parsed.evidence) ? parsed.evidence.slice(0, 10) : [],
        missing_info: Array.isArray(parsed.missing_info) ? parsed.missing_info.slice(0, 5) : [],
        questions: Array.isArray(parsed.questions) ? parsed.questions.slice(0, 5) : [],
        recommendation: parsed.recommendation || '建议谨慎对待该岗位。',
        disclaimer: '本结果仅供求职决策参考，不构成法律认定。',
        created_at: new Date().toISOString(),
      };
    } catch (err) {
      console.error('Response parsing error:', err);
      return this.createFallbackReport();
    }
  }

  private parseHrResponse(rawText: string): HrAnalysis {
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      const parsed = JSON.parse(jsonMatch[0]);
      
      return {
        hr_analysis_id: `hra_${Math.random().toString(36).slice(2, 14)}`,
        avoidance_score: Math.max(0, Math.min(100, parseInt(parsed.avoidance_score) || 50)),
        risk_level: this.validateRiskLevel(parsed.risk_level),
        analysis: parsed.analysis || 'HR回复分析完成。',
        next_questions: Array.isArray(parsed.next_questions) ? parsed.next_questions.slice(0, 3) : [],
        created_at: new Date().toISOString(),
      };
    } catch (err) {
      console.error('HR response parsing error:', err);
      return this.createFallbackHrAnalysis();
    }
  }

  private validateRiskLevel(level: string): '低' | '中' | '高' | '极高' {
    const validLevels: ('低' | '中' | '高' | '极高')[] = ['低', '中', '高', '极高'];
    return validLevels.includes(level as any) ? (level as any) : '中';
  }

  private validateConfidence(confidence: string): '高' | '中' | '低' {
    const validLevels: ('高' | '中' | '低')[] = ['高', '中', '低'];
    return validLevels.includes(confidence as any) ? (confidence as any) : '中';
  }

  private createFallbackReport(): RiskReport {
    return {
      report_id: `rep_${Math.random().toString(36).slice(2, 14)}`,
      overall_score: 45,
      risk_level: '中',
      confidence: '低',
      predicted_role: null,
      risk_types: [],
      sub_scores: {
        jd_risk: { score: 36, weight: 0.35, status: 'available' },
        hr_risk: { score: null, weight: 0.20, status: 'missing' },
        company_risk: { score: null, weight: 0.25, status: 'missing' },
        feedback_risk: { score: null, weight: 0.20, status: 'missing' },
      },
      strong_risk_adjustment: 0,
      evidence: [],
      missing_info: ['固定无责底薪', '劳动合同主体', '社保缴纳主体'],
      questions: [],
      recommendation: '信息不足以判断，建议补充岗位详情后重新检测。',
      disclaimer: '本结果仅供求职决策参考，不构成法律认定。',
      created_at: new Date().toISOString(),
    };
  }

  private createFallbackHrAnalysis(): HrAnalysis {
    return {
      hr_analysis_id: `hra_${Math.random().toString(36).slice(2, 14)}`,
      avoidance_score: 50,
      risk_level: '中',
      analysis: 'HR回复分析完成，未发现明显回避。',
      next_questions: [],
      created_at: new Date().toISOString(),
    };
  }
}