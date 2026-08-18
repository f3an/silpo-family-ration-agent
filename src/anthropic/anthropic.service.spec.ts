import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicService } from './anthropic.service';

describe('AnthropicService', () => {
  it('builds an Anthropic client using the configured API key', () => {
    const get = jest.fn().mockReturnValue('sk-ant-test-key');
    const configService = { get } as unknown as ConfigService;

    const service = new AnthropicService(configService);

    expect(get).toHaveBeenCalledWith('ANTHROPIC_API_KEY');
    expect(service.getClient()).toBeInstanceOf(Anthropic);
  });

  it('returns the same client instance on repeated calls', () => {
    // A real API key is required here, not just for the assertion: with no
    // key, the SDK kicks off an async credential-discovery chain (OAuth
    // profile, WIF, ...) that outlives the test and logs a "torn down
    // environment" warning once Jest tears down the module registry.
    const configService = {
      get: jest.fn().mockReturnValue('sk-ant-test-key'),
    } as unknown as ConfigService;
    const service = new AnthropicService(configService);

    expect(service.getClient()).toBe(service.getClient());
  });
});
