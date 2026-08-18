import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicService } from './anthropic.service';

// Mock the SDK so we test AnthropicService's own branching logic, not the
// real SDK's credential resolution. Constructing a real `new Anthropic()`
// with no API key kicks off an async credential-discovery chain (OAuth
// profile, WIF, ...) that outlives the test and logs a "torn down
// environment" warning once Jest tears down the module registry.
jest.mock('@anthropic-ai/sdk');

const MockAnthropic = Anthropic as jest.MockedClass<typeof Anthropic>;

describe('AnthropicService', () => {
  beforeEach(() => {
    MockAnthropic.mockClear();
  });

  it('builds the client with the configured API key when ANTHROPIC_API_KEY is set', () => {
    const get = jest.fn().mockReturnValue('sk-ant-test-key');
    const configService = { get } as unknown as ConfigService;

    const service = new AnthropicService(configService);

    expect(get).toHaveBeenCalledWith('ANTHROPIC_API_KEY');
    expect(MockAnthropic).toHaveBeenCalledWith({ apiKey: 'sk-ant-test-key' });
    expect(service.getClient()).toBeInstanceOf(Anthropic);
  });

  it('falls back to the local credential chain (e.g. a subscription profile from `ant auth login`) when no API key is set', () => {
    const configService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;

    new AnthropicService(configService);

    expect(MockAnthropic).toHaveBeenCalledWith();
  });

  it('treats an empty ANTHROPIC_API_KEY the same as unset', () => {
    const configService = {
      get: jest.fn().mockReturnValue(''),
    } as unknown as ConfigService;

    new AnthropicService(configService);

    expect(MockAnthropic).toHaveBeenCalledWith();
  });

  it('returns the same client instance on repeated calls', () => {
    const configService = {
      get: jest.fn().mockReturnValue('sk-ant-test-key'),
    } as unknown as ConfigService;
    const service = new AnthropicService(configService);

    expect(service.getClient()).toBe(service.getClient());
  });
});
