import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Owns the single Anthropic client.
 *
 * Prefers an explicit ANTHROPIC_API_KEY (production/CI). If it's unset,
 * falls back to a bare `new Anthropic()` — the SDK then resolves
 * credentials itself via ANTHROPIC_AUTH_TOKEN, an `ant auth login` OAuth
 * profile (e.g. a personal Claude subscription), or Workload Identity
 * Federation. This lets local dev run without anyone provisioning a
 * separate API key.
 */
@Injectable()
export class AnthropicService {
  private readonly logger = new Logger(AnthropicService.name);
  private readonly client: Anthropic;

  constructor(configService: ConfigService) {
    const apiKey = configService.get<string>('ANTHROPIC_API_KEY');

    if (apiKey) {
      this.client = new Anthropic({ apiKey });
      this.logger.log('Using ANTHROPIC_API_KEY.');
    } else {
      this.client = new Anthropic();
      this.logger.log(
        'No ANTHROPIC_API_KEY set — falling back to the local Claude credential chain (e.g. a subscription profile from `ant auth login`). Run `ant auth status` to check what will be used.',
      );
    }
  }

  getClient(): Anthropic {
    return this.client;
  }
}
