import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicService } from './anthropic.service';
import { AnthropicLlmClient } from '../llm/anthropicLlmClient';
import { LocalOpenAiLlmClient } from '../llm/localOpenAiLlmClient';

jest.mock('@anthropic-ai/sdk');

const MockAnthropic = Anthropic as jest.MockedClass<typeof Anthropic>;

function fakeConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('AnthropicService', () => {
  beforeEach(() => {
    MockAnthropic.mockClear();
  });

  describe('LLM_PROVIDER unset/"anthropic" (default)', () => {
    it('builds an AnthropicLlmClient with the configured API key', () => {
      const configService = fakeConfig({
        ANTHROPIC_API_KEY: 'sk-ant-test-key',
      });

      const service = new AnthropicService(configService);

      expect(MockAnthropic).toHaveBeenCalledWith({ apiKey: 'sk-ant-test-key' });
      expect(service.getClient()).toBeInstanceOf(AnthropicLlmClient);
    });

    it('throws when ANTHROPIC_API_KEY is not set', () => {
      const configService = fakeConfig({});

      expect(() => new AnthropicService(configService)).toThrow(
        'ANTHROPIC_API_KEY is required',
      );
    });

    it('treats an empty ANTHROPIC_API_KEY the same as unset', () => {
      const configService = fakeConfig({ ANTHROPIC_API_KEY: '' });

      expect(() => new AnthropicService(configService)).toThrow(
        'ANTHROPIC_API_KEY is required',
      );
    });

    it('returns the same client instance on repeated calls', () => {
      const configService = fakeConfig({
        ANTHROPIC_API_KEY: 'sk-ant-test-key',
      });
      const service = new AnthropicService(configService);

      expect(service.getClient()).toBe(service.getClient());
    });
  });

  describe('LLM_PROVIDER=openai', () => {
    it('builds a LocalOpenAiLlmClient pointed at the real OpenAI API with GPT-5.6+ overrides', () => {
      const configService = fakeConfig({
        LLM_PROVIDER: 'openai',
        OPENAI_API_KEY: 'sk-openai-test-key',
      });

      const service = new AnthropicService(configService);

      expect(service.getClient()).toBeInstanceOf(LocalOpenAiLlmClient);
      expect(MockAnthropic).not.toHaveBeenCalled();
    });

    it('defaults OPENAI_MODEL to gpt-5.6-luna', () => {
      const configService = fakeConfig({
        LLM_PROVIDER: 'openai',
        OPENAI_API_KEY: 'sk-openai-test-key',
      });
      // model is private on LocalOpenAiLlmClient — assert indirectly via
      // the logged message, same as the local-dialect tests do for baseUrl.
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

      new AnthropicService(configService);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('gpt-5.6-luna'),
      );
      logSpy.mockRestore();
    });

    it('throws when OPENAI_API_KEY is not set', () => {
      const configService = fakeConfig({ LLM_PROVIDER: 'openai' });

      expect(() => new AnthropicService(configService)).toThrow(
        'OPENAI_API_KEY is required',
      );
    });
  });

  describe('LLM_PROVIDER=local', () => {
    it('defaults to the Anthropic dialect — a real Anthropic client pointed at LOCAL_LLM_BASE_URL, no ANTHROPIC_API_KEY needed', () => {
      const configService = fakeConfig({
        LLM_PROVIDER: 'local',
        LOCAL_LLM_BASE_URL: 'http://192.168.1.50:1234/v1',
        LOCAL_LLM_MODEL: 'qwen2.5-7b-instruct',
      });

      const service = new AnthropicService(configService);

      expect(service.getClient()).toBeInstanceOf(AnthropicLlmClient);
      // The SDK appends its own /v1/messages onto baseURL — LOCAL_LLM_BASE_URL's
      // own /v1 suffix (needed by the openai dialect) must be stripped here,
      // or the real request 404s on /v1/v1/messages (confirmed live).
      expect(MockAnthropic).toHaveBeenCalledWith({
        apiKey: 'local',
        baseURL: 'http://192.168.1.50:1234',
      });
    });

    it('strips a trailing slash after /v1 too', () => {
      const configService = fakeConfig({
        LLM_PROVIDER: 'local',
        LOCAL_LLM_BASE_URL: 'http://192.168.1.50:1234/v1/',
        LOCAL_LLM_MODEL: 'qwen2.5-7b-instruct',
      });

      new AnthropicService(configService);

      expect(MockAnthropic).toHaveBeenCalledWith({
        apiKey: 'local',
        baseURL: 'http://192.168.1.50:1234',
      });
    });

    it('LOCAL_LLM_API=openai builds a LocalOpenAiLlmClient instead', () => {
      const configService = fakeConfig({
        LLM_PROVIDER: 'local',
        LOCAL_LLM_API: 'openai',
        LOCAL_LLM_BASE_URL: 'http://192.168.1.50:1234/v1',
        LOCAL_LLM_MODEL: 'qwen2.5-7b-instruct',
      });

      const service = new AnthropicService(configService);

      expect(service.getClient()).toBeInstanceOf(LocalOpenAiLlmClient);
      expect(MockAnthropic).not.toHaveBeenCalled();
    });

    it('throws when LOCAL_LLM_BASE_URL is missing', () => {
      const configService = fakeConfig({
        LLM_PROVIDER: 'local',
        LOCAL_LLM_MODEL: 'qwen2.5-7b-instruct',
      });

      expect(() => new AnthropicService(configService)).toThrow(
        'LLM_PROVIDER=local requires',
      );
    });

    it('throws when LOCAL_LLM_MODEL is missing', () => {
      const configService = fakeConfig({
        LLM_PROVIDER: 'local',
        LOCAL_LLM_BASE_URL: 'http://192.168.1.50:1234/v1',
      });

      expect(() => new AnthropicService(configService)).toThrow(
        'LLM_PROVIDER=local requires',
      );
    });

    describe('getDraftClient', () => {
      it('returns a second, distinct LocalOpenAiLlmClient when LOCAL_DRAFT_LLM_MODEL is set (openai dialect)', () => {
        const configService = fakeConfig({
          LLM_PROVIDER: 'local',
          LOCAL_LLM_API: 'openai',
          LOCAL_LLM_BASE_URL: 'http://192.168.1.50:1234/v1',
          LOCAL_LLM_MODEL: 'qwen2.5-7b-instruct',
          LOCAL_DRAFT_LLM_MODEL: 'meta-llama-3.1-8b-instruct',
        });

        const service = new AnthropicService(configService);

        expect(service.getDraftClient()).toBeInstanceOf(LocalOpenAiLlmClient);
        expect(service.getDraftClient()).not.toBe(service.getClient());
      });

      it('falls back to the same client as getClient() when LOCAL_DRAFT_LLM_MODEL is unset', () => {
        const configService = fakeConfig({
          LLM_PROVIDER: 'local',
          LOCAL_LLM_API: 'openai',
          LOCAL_LLM_BASE_URL: 'http://192.168.1.50:1234/v1',
          LOCAL_LLM_MODEL: 'qwen2.5-7b-instruct',
        });

        const service = new AnthropicService(configService);

        expect(service.getDraftClient()).toBe(service.getClient());
      });

      it('falls back to the same client as getClient() on the Anthropic-dialect local path, even when LOCAL_DRAFT_LLM_MODEL is set — that dialect ignores the requested model regardless', () => {
        const configService = fakeConfig({
          LLM_PROVIDER: 'local',
          LOCAL_LLM_BASE_URL: 'http://192.168.1.50:1234/v1',
          LOCAL_LLM_MODEL: 'qwen2.5-7b-instruct',
          LOCAL_DRAFT_LLM_MODEL: 'meta-llama-3.1-8b-instruct',
        });

        const service = new AnthropicService(configService);

        expect(service.getDraftClient()).toBe(service.getClient());
      });

      it('falls back to the same client as getClient() for the real Anthropic provider', () => {
        const configService = fakeConfig({
          ANTHROPIC_API_KEY: 'sk-ant-test-key',
        });

        const service = new AnthropicService(configService);

        expect(service.getDraftClient()).toBe(service.getClient());
      });
    });
  });
});
