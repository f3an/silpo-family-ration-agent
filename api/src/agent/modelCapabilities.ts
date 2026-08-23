/**
 * `output_config.effort` (adaptive-thinking tuning) isn't universally
 * supported — confirmed live: Claude Haiku 4.5 400s with "This model does
 * not support the effort parameter." Cheaper/faster models in the Haiku
 * line apparently don't expose it. Local models (see llm/) never see this
 * field's absence either way — the local-Anthropic-dialect path forwards
 * whatever `output_config` it's given as-is, and LM Studio ignores fields
 * it doesn't recognize rather than rejecting the request.
 */
export function supportsEffort(model: string): boolean {
  return !model.includes('haiku');
}

/**
 * Explicit `temperature` was only ever added as a workaround for weak
 * *local* models generating garbled/hallucinated text — real Claude models
 * never had that problem and don't need it forced on. Confirmed live this
 * session that it's rejected outright ("`temperature` is deprecated for
 * this model") — and unlike `effort` (Haiku-specific), this held even after
 * ruling out a stale-process/stale-build explanation, so this isn't just a
 * Haiku quirk — treat every real `claude-*` model id as not supporting it,
 * rather than guessing which specific ones do. Local model ids (e.g.
 * "qwen/qwen2.5-7b-instruct", "meta-llama-3.1-8b-instruct") never start
 * with "claude-", so they're unaffected either way.
 */
export function supportsTemperature(model: string): boolean {
  return !model.startsWith('claude-');
}
