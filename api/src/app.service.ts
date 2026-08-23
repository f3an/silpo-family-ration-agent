import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getStatus(): { service: string; status: 'ok' } {
    return { service: 'silpo-family-ration-agent', status: 'ok' };
  }
}
