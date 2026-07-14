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

const QWEN_ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';
const REQUEST_TIMEOUT_MS = 60_000;

interface QwenResponse {
  output?: { choices?: Array<{ message?: { content?: unknown } }> };
  usage?: Record<string, unknown>;
}

export class QwenCloudProvider {
  name = 'qwen-cloud';
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = requireApiKey(
      this.name,
      apiKey?.trim() || process.env.QWENCLOUD_API_KEY?.trim() || process.env.QWEN_API_KEY?.trim(),
      ['QWENCLOUD_API_KEY', 'QWEN_API_KEY'],
    );
    this.model = model?.trim() || process.env.QWENCLOUD_MODEL?.trim() || process.env.QWEN_MODEL?.trim() || 'qwen-plus';
  }

  async analyzeJobRisk(input: JobRiskInput): Promise<LlmProviderResult> {
    const startTime = Date.now();
    try {
      const response = await this.request(buildJobRiskMessages(input), 2_000);
      const rawText = responseText(response.data.output?.choices?.[0]?.message?.content, this.name);
      const parsedJson = parseJobRiskResponse(rawText, Boolean(input.hr_chat_text));
      return this.result(rawText, parsedJson, response.data.usage, startTime);
    } catch (error) {
      console.error('Qwen Cloud request failed', safeProviderError(error));
      throw error;
    }
  }

  async analyzeHrReply(input: HrReplyInput): Promise<LlmProviderResult> {
    const startTime = Date.now();
    try {
      const response = await this.request(buildHrReplyMessages(input), 1_000);
      const rawText = responseText(response.data.output?.choices?.[0]?.message?.content, this.name);
      const parsedJson = parseHrReplyResponse(rawText, input.report_id);
      return this.result(rawText, parsedJson, response.data.usage, startTime);
    } catch (error) {
      console.error('Qwen Cloud request failed', safeProviderError(error));
      throw error;
    }
  }

  private request(messages: ReturnType<typeof buildJobRiskMessages>, maxTokens: number) {
    // Validate again at the call boundary in case this class is later instantiated indirectly.
    requireApiKey(this.name, this.apiKey, ['QWENCLOUD_API_KEY', 'QWEN_API_KEY']);
    return axios.post<QwenResponse>(
      QWEN_ENDPOINT,
      {
        model: this.model,
        input: { messages },
        parameters: { temperature: 0.3, max_tokens: maxTokens, result_format: 'message' },
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
      inputPricePerMillion: optionalPrice(process.env.QWEN_INPUT_PRICE_PER_MILLION),
      outputPricePerMillion: optionalPrice(process.env.QWEN_OUTPUT_PRICE_PER_MILLION),
    });
  }
}
