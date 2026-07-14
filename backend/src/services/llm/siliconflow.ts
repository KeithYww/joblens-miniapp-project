import axios from 'axios';
import type { LlmProviderResult } from '../../types';
import {
  buildHrReplyMessages,
  buildJobRiskMessages,
  buildProviderResult,
  optionalPrice,
  parseHrReplyResponse,
  parseJobRiskResponse,
  requireApiKey,
  responseText,
  safeProviderError,
} from './common';
import type { HrReplyInput, JobRiskInput } from './common';

const SILICONFLOW_ENDPOINT = 'https://api.siliconflow.cn/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 60_000;

interface SiliconFlowResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: Record<string, unknown>;
}

export class SiliconFlowProvider {
  name = 'siliconflow';
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = requireApiKey(this.name, apiKey?.trim() || process.env.SILICONFLOW_API_KEY?.trim(), ['SILICONFLOW_API_KEY']);
    this.model = model?.trim() || process.env.SILICONFLOW_MODEL?.trim() || 'deepseek-chat';
  }

  async analyzeJobRisk(input: JobRiskInput): Promise<LlmProviderResult> {
    const startTime = Date.now();
    try {
      const response = await this.request(buildJobRiskMessages(input), 2_000);
      const rawText = responseText(response.data.choices?.[0]?.message?.content, this.name);
      const parsedJson = parseJobRiskResponse(rawText, Boolean(input.hr_chat_text));
      return this.result(rawText, parsedJson, response.data.usage, startTime);
    } catch (error) {
      console.error('SiliconFlow request failed', safeProviderError(error));
      throw error;
    }
  }

  async analyzeHrReply(input: HrReplyInput): Promise<LlmProviderResult> {
    const startTime = Date.now();
    try {
      const response = await this.request(buildHrReplyMessages(input), 1_000);
      const rawText = responseText(response.data.choices?.[0]?.message?.content, this.name);
      const parsedJson = parseHrReplyResponse(rawText, input.report_id);
      return this.result(rawText, parsedJson, response.data.usage, startTime);
    } catch (error) {
      console.error('SiliconFlow request failed', safeProviderError(error));
      throw error;
    }
  }

  private request(messages: ReturnType<typeof buildJobRiskMessages>, maxTokens: number) {
    requireApiKey(this.name, this.apiKey, ['SILICONFLOW_API_KEY']);
    return axios.post<SiliconFlowResponse>(
      SILICONFLOW_ENDPOINT,
      {
        model: this.model,
        messages,
        temperature: 0.3,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      },
      {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        timeout: REQUEST_TIMEOUT_MS,
      },
    );
  }

  private result(rawText: string, parsedJson: unknown, usage: Record<string, unknown> | undefined, startTime: number) {
    return buildProviderResult({
      rawText,
      parsedJson,
      model: this.model,
      provider: this.name,
      usage,
      latencyMs: Date.now() - startTime,
      inputPricePerMillion: optionalPrice(process.env.SILICONFLOW_INPUT_PRICE_PER_MILLION),
      outputPricePerMillion: optionalPrice(process.env.SILICONFLOW_OUTPUT_PRICE_PER_MILLION),
    });
  }
}
