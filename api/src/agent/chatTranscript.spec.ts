import type Anthropic from '@anthropic-ai/sdk';
import { toChatTranscript, deriveConversationTitle } from './chatTranscript';
import type { ChatWidget } from './chatConversation.service';

describe('toChatTranscript', () => {
  it('keeps plain string user/assistant turns as-is', () => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: 'привіт' },
      { role: 'assistant', content: 'Привіт! Чим допомогти?' },
    ];

    expect(toChatTranscript(messages)).toEqual([
      { role: 'user', text: 'привіт' },
      { role: 'assistant', text: 'Привіт! Чим допомогти?' },
    ]);
  });

  it('extracts text blocks from an assistant turn that also has tool_use blocks', () => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: 'скільки калорій у борщі?' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Зараз перевірю.' },
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'silpo_get_products',
            input: {},
          },
        ],
      },
    ];

    expect(toChatTranscript(messages)).toEqual([
      { role: 'user', text: 'скільки калорій у борщі?' },
      { role: 'assistant', text: 'Зараз перевірю.' },
    ]);
  });

  it('drops turns that are pure tool plumbing (no text content)', () => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: 'привіт' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'silpo_get_my_family',
            input: {},
          },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: '{}' },
        ],
      },
      { role: 'assistant', content: 'Ось відповідь.' },
    ];

    expect(toChatTranscript(messages)).toEqual([
      { role: 'user', text: 'привіт' },
      { role: 'assistant', text: 'Ось відповідь.' },
    ]);
  });
});

describe('toChatTranscript widget attachment', () => {
  it('attaches a widget to the turn at its original messages index, even after earlier tool-plumbing turns are dropped', () => {
    const messages: Anthropic.MessageParam[] = [
      // index 0 — pure tool plumbing, gets dropped
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'silpo_get_my_family',
            input: {},
          },
        ],
      },
      // index 1 — pure tool plumbing, gets dropped
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: '{}' },
        ],
      },
      // index 2 — kept, no widget
      { role: 'user', content: 'Склади раціон: 2 особи, 3 дні.' },
      // index 3 — kept, carries the widget
      {
        role: 'assistant',
        content: 'Раціон готовий: Борщ — 1 страва на 3 дн.',
      },
    ];
    const widgets: ChatWidget[] = [
      { messageIndex: 3, kind: 'dish_plan', dishes: [] },
    ];

    const turns = toChatTranscript(messages, widgets);

    expect(turns).toEqual([
      { role: 'user', text: 'Склади раціон: 2 особи, 3 дні.' },
      {
        role: 'assistant',
        text: 'Раціон готовий: Борщ — 1 страва на 3 дн.',
        widgets,
      },
    ]);
  });

  it('attaches multiple widgets to the same turn — an event turn producing both dishes and a basket', () => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: 'День народження на 6 гостей' },
      {
        role: 'assistant',
        content: 'Ось гарячі страви і набір закусок:',
      },
    ];
    const widgets: ChatWidget[] = [
      { messageIndex: 1, kind: 'dish_plan', dishes: [] },
      {
        messageIndex: 1,
        kind: 'occasion_basket',
        basket: {
          theme: 'День народження',
          description: '',
          guestCount: 6,
          items: [],
        },
      },
    ];

    const turns = toChatTranscript(messages, widgets);

    expect(turns[1].widgets).toEqual(widgets);
  });

  it('defaults to no widgets when none are passed', () => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: 'привіт' },
    ];

    expect(toChatTranscript(messages)).toEqual([
      { role: 'user', text: 'привіт' },
    ]);
  });
});

describe('deriveConversationTitle', () => {
  it('uses the first line of the message', () => {
    expect(deriveConversationTitle('раціон на тиждень\nдодаткові деталі')).toBe(
      'раціон на тиждень',
    );
  });

  it('collapses internal whitespace', () => {
    expect(deriveConversationTitle('раціон   на    тиждень')).toBe(
      'раціон на тиждень',
    );
  });

  it('truncates long messages to 60 chars with an ellipsis', () => {
    const long = 'а'.repeat(80);

    const title = deriveConversationTitle(long);

    expect(title).toBe(`${'а'.repeat(60)}…`);
  });

  it('falls back to a default title for an empty/whitespace message', () => {
    expect(deriveConversationTitle('   ')).toBe('Нова розмова');
  });
});
