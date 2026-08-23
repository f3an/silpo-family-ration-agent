import { supportsEffort, supportsTemperature } from './modelCapabilities';

describe('supportsEffort', () => {
  it('returns false for Haiku models — confirmed live: 400s with "This model does not support the effort parameter"', () => {
    expect(supportsEffort('claude-haiku-4-5-20251001')).toBe(false);
  });

  it('returns true for Sonnet/Opus models', () => {
    expect(supportsEffort('claude-sonnet-5')).toBe(true);
    expect(supportsEffort('claude-opus-5')).toBe(true);
  });
});

describe('supportsTemperature', () => {
  it('returns false for any real claude-* model — confirmed live: 400s with "`temperature` is deprecated for this model", and this held for Haiku even after ruling out a stale-process explanation, so it is treated as generation-wide rather than Haiku-specific', () => {
    expect(supportsTemperature('claude-haiku-4-5-20251001')).toBe(false);
    expect(supportsTemperature('claude-sonnet-5')).toBe(false);
    expect(supportsTemperature('claude-opus-5')).toBe(false);
  });

  it('returns true for local (non-claude-prefixed) model ids', () => {
    expect(supportsTemperature('qwen/qwen2.5-7b-instruct')).toBe(true);
    expect(supportsTemperature('meta-llama-3.1-8b-instruct')).toBe(true);
    expect(supportsTemperature('google/gemma-4-e4b')).toBe(true);
  });
});
