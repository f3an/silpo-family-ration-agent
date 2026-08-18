import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

/** Owns the single Anthropic client, built from config instead of a bare DI token. */
@Injectable()
export class AnthropicService {
  private readonly client: Anthropic;

  constructor(configService: ConfigService) {
    this.client = new Anthropic({
      apiKey: configService.get<string>('ANTHROPIC_API_KEY'),
    });
  }

  getClient(): Anthropic {
    return this.client;
  }
}
