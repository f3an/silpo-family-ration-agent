import type Anthropic from '@anthropic-ai/sdk';
import type { ChatWidget } from './chatConversation.service';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  /** Usually one entry — an event turn can attach both a `dish_plan` and an
   * `occasion_basket` widget to the same message (see run.ts's occasion
   * scenario: dishes that need cooking + ready-to-buy extras in one turn). */
  widgets?: ChatWidget[];
}

/**
 * Collapses the raw Claude/MCP tool-use loop history (which interleaves
 * tool_use/tool_result round-trips between the real back-and-forth) down to
 * the plain turns a human actually typed/read — for the sidenav's "open a
 * past conversation" view. A message that's pure tool plumbing (no text
 * content — e.g. an assistant turn that's only a tool_use block, or a user
 * turn that's only a tool_result block) has nothing to show and is dropped.
 * `runAgentTurn` only ever pushes 'user'/'assistant' turns, but the SDK's
 * `MessageParam.role` type also allows 'system' (mid-conversation system
 * messages) — those are dropped here too, since this loop never produces one.
 *
 * `widgets` attach by the message's original index in `messages` — computed
 * *before* filtering, since a dropped tool-plumbing turn would otherwise
 * shift a later widget onto the wrong turn.
 */
export function toChatTranscript(
  messages: Anthropic.MessageParam[],
  widgets: ChatWidget[] = [],
): ChatTurn[] {
  const widgetsByIndex = new Map<number, ChatWidget[]>();
  for (const w of widgets) {
    const existing = widgetsByIndex.get(w.messageIndex);
    if (existing) existing.push(w);
    else widgetsByIndex.set(w.messageIndex, [w]);
  }
  const turns: ChatTurn[] = [];

  messages.forEach((message, index) => {
    if (message.role !== 'user' && message.role !== 'assistant') return;
    const role = message.role;
    const widgets = widgetsByIndex.get(index);

    if (typeof message.content === 'string') {
      const text = message.content.trim();
      if (text || widgets)
        turns.push({ role, text, ...(widgets && { widgets }) });
      return;
    }

    const text = message.content
      .filter(
        (block): block is Anthropic.TextBlockParam => block.type === 'text',
      )
      .map((block) => block.text)
      .join('\n')
      .trim();
    if (text || widgets)
      turns.push({ role, text, ...(widgets && { widgets }) });
  });

  return turns;
}

/** First line of the guest's first message, trimmed to a reasonable sidenav
 * label — same idea as ChatGPT/Claude auto-titling a new conversation. */
export function deriveConversationTitle(message: string): string {
  const firstLine = message.trim().split('\n')[0].replace(/\s+/g, ' ');
  if (!firstLine) return 'Нова розмова';
  return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
}
