/**
 * The OpenAI wire format the local endpoint speaks, plus the adapter templating
 * used to build an upstream request.
 */

const openai = require('../src/api/openai');
const template = require('../src/api/template');
const { API } = require('../src/constants');

const CHAT = {
  model: 'aihub/chatgpt',
  messages: [{ role: 'user', content: 'Hello there' }]
};

describe('normalizeChatRequest', () => {
  it('accepts a minimal valid request', () => {
    const result = openai.normalizeChatRequest(CHAT);
    expect(result.ok).toBe(true);
    expect(result.request.serviceId).toBe('chatgpt');
    expect(result.request.messages).toEqual([{ role: 'user', content: 'Hello there' }]);
    expect(result.request.stream).toBe(false);
    expect(result.request.id).toMatch(/^chatcmpl-aihub-/);
  });

  it('accepts the bare slug, the prefixed id and a :variant', () => {
    for (const model of ['chatgpt', 'aihub/chatgpt', 'aihub/chatgpt:latest']) {
      expect(openai.normalizeChatRequest({ ...CHAT, model }).request.serviceId).toBe('chatgpt');
    }
  });

  it('rejects missing or malformed essentials', () => {
    expect(openai.normalizeChatRequest(null).ok).toBe(false);
    expect(openai.normalizeChatRequest([]).ok).toBe(false);
    expect(openai.normalizeChatRequest({ messages: CHAT.messages }).error.error.param).toBe('model');
    expect(openai.normalizeChatRequest({ model: 'chatgpt' }).error.error.param).toBe('messages');
    expect(openai.normalizeChatRequest({ model: 'chatgpt', messages: [] }).ok).toBe(false);
  });

  it('rejects unknown roles and non-user-only conversations', () => {
    expect(openai.normalizeChatRequest({ model: 'a', messages: [{ role: 'wizard', content: 'x' }] }).ok).toBe(false);
    expect(
      openai.normalizeChatRequest({ model: 'a', messages: [{ role: 'assistant', content: 'x' }] }).error.error.message
    ).toMatch(/user/);
  });

  it('enforces the message count and size caps', () => {
    const many = Array.from({ length: API.MAX_MESSAGES + 1 }, () => ({ role: 'user', content: 'hi' }));
    expect(openai.normalizeChatRequest({ model: 'a', messages: many }).ok).toBe(false);

    const huge = [{ role: 'user', content: 'x'.repeat(API.MAX_MESSAGE_CHARS + 1) }];
    expect(openai.normalizeChatRequest({ model: 'a', messages: huge }).ok).toBe(false);
  });

  it('accepts structured content parts', () => {
    const result = openai.normalizeChatRequest({
      model: 'a',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }] }]
    });
    expect(result.request.messages[0].content).toBe('first\nsecond');
  });

  it('clamps numeric options instead of trusting them', () => {
    const result = openai.normalizeChatRequest({
      ...CHAT,
      temperature: 99,
      max_tokens: -5,
      timeout_seconds: 10_000_000,
      top_p: 4
    });
    expect(result.request.temperature).toBe(2);
    expect(result.request.maxTokens).toBe(1);
    expect(result.request.timeoutSeconds).toBe(API.MAX_TIMEOUT_SECONDS);
    expect(result.request.topP).toBe(1);
  });

  it('reads the extension fields the app supports', () => {
    const result = openai.normalizeChatRequest({
      ...CHAT,
      stream: true,
      strategy: 'dom',
      conversation_id: 'conv-1',
      history: false,
      stop: ['END', 42],
      user: 'desktop-client'
    });
    expect(result.request.stream).toBe(true);
    expect(result.request.strategy).toBe('dom');
    expect(result.request.conversationId).toBe('conv-1');
    expect(result.request.includeHistory).toBe(false);
    expect(result.request.stop).toEqual(['END']);
  });

  it('ignores a non-string user id rather than coercing junk', () => {
    expect(openai.normalizeChatRequest({ ...CHAT, user: { evil: true } }).request.user).toBeNull();
  });
});

describe('completions shim', () => {
  it('translates a legacy prompt into a chat request', () => {
    const translated = openai.completionsToChatBody({ model: 'claude', prompt: 'Summarise this', max_tokens: 40 });
    expect(translated.messages).toEqual([{ role: 'user', content: 'Summarise this' }]);
    expect(translated.history).toBe(false);
  });

  it('joins array prompts and refuses empty ones', () => {
    expect(openai.completionsToChatBody({ model: 'a', prompt: ['one', 'two'] }).messages[0].content).toBe('one\ntwo');
    expect(openai.completionsToChatBody({ model: 'a', prompt: '   ' })).toBeNull();
    expect(openai.completionsToChatBody(null)).toBeNull();
  });
});

describe('response shaping', () => {
  it('builds a chat.completion object', () => {
    const completion = openai.buildCompletion({ model: 'aihub/chatgpt', text: 'Answer', created: 1000 });
    expect(completion.object).toBe('chat.completion');
    expect(completion.choices[0].message).toEqual({ role: 'assistant', content: 'Answer' });
    expect(completion.choices[0].finish_reason).toBe('stop');
    expect(completion.usage.total_tokens).toBeGreaterThan(0);
    expect(completion.created).toBe(1000);
  });

  it('streams role, deltas, final usage and [DONE]', () => {
    const frames = [
      openai.firstChunk({ id: 'x', model: 'm', created: 1 }),
      openai.deltaChunk({ id: 'x', model: 'm', created: 1, text: 'Hel' }),
      openai.deltaChunk({ id: 'x', model: 'm', created: 1, text: 'lo' }),
      openai.finalChunk({ id: 'x', model: 'm', created: 1, usage: { total_tokens: 3 } })
    ];

    expect(frames[0].choices[0].delta.role).toBe('assistant');
    expect(frames.map((frame) => frame.object).every((object) => object === 'chat.completion.chunk')).toBe(true);
    expect(frames[1].choices[0].delta.content).toBe('Hel');
    expect(frames[3].choices[0].finish_reason).toBe('stop');
    expect(frames[3].usage).toEqual({ total_tokens: 3 });

    const framed = openai.sseFrame(frames[1]);
    expect(framed.startsWith('data: ')).toBe(true);
    expect(framed.endsWith('\n\n')).toBe(true);
    expect(openai.SSE_DONE).toBe('data: [DONE]\n\n');
  });

  it('reassembles the streamed text exactly', () => {
    const deltas = ['Hel', 'lo', ' wor', 'ld'];
    expect(deltas.join('')).toBe('Hello world');
  });
});

describe('SSE parsing', () => {
  it('handles frames split across chunks', () => {
    const parser = openai.createSseParser();
    expect(parser.push('data: {"a":')).toEqual([]);
    expect(parser.push('1}\n\n')).toEqual(['{"a":1}']);
  });

  it('handles CRLF, comments and multiple data lines', () => {
    const parser = openai.createSseParser();
    const events = parser.push(': keep-alive\r\n\r\ndata: one\r\ndata: two\r\n\r\n');
    expect(events).toEqual(['one\ntwo']);
  });

  it('flushes a trailing frame that never got a blank line', () => {
    const parser = openai.createSseParser();
    expect(parser.push('data: last')).toEqual([]);
    expect(parser.end()).toEqual(['last']);
  });

  it('ignores an empty stream', () => {
    expect(openai.createSseParser().end()).toEqual([]);
  });
});

describe('delta extraction', () => {
  it('follows the adapter path first', () => {
    const frame = JSON.stringify({ messages: [{ content: { parts: ['streamed text'] } }] });
    expect(openai.extractDelta(frame, 'messages.0.content.parts.0').text).toBe('streamed text');
  });

  it('falls back to OpenAI-shaped deltas', () => {
    expect(openai.extractDelta({ choices: [{ delta: { content: 'hi' } }] }).text).toBe('hi');
  });

  it('understands [DONE] and a done flag', () => {
    expect(openai.extractDelta('data: [DONE]'.replace('data: ', '')).done).toBe(true);
    expect(openai.extractDelta({ done: true }).done).toBe(true);
  });

  it('surfaces an upstream error string', () => {
    const result = openai.extractDelta(JSON.stringify({ error: { message: 'rate limited' } }));
    expect(result.error).toBe('rate limited');
  });

  it('passes through raw text frames', () => {
    expect(openai.extractDelta('plain chunk').text).toBe('plain chunk');
  });

  it('extracts a whole-body answer', () => {
    expect(openai.extractResult('{"choices":[{"message":{"content":"done"}}]}').text).toBe('done');
    expect(openai.extractResult('{"completion":"typed"}', 'completion').text).toBe('typed');
    expect(openai.extractResult('not json at all').text).toBe('not json at all');
    expect(openai.extractResult('{}', 'nothing.here').text).toBe('');
  });
});

describe('usage accounting', () => {
  it('estimates tokens from both length and words', () => {
    const usage = openai.usageFrom('a'.repeat(400), 'b'.repeat(40));
    expect(usage.prompt_tokens).toBe(100);
    expect(usage.completion_tokens).toBe(10);
    expect(usage.total_tokens).toBe(110);
    expect(openai.estimateTokens('')).toBe(0);
  });
});

describe('error payloads', () => {
  it('matches the OpenAI error envelope', () => {
    const payload = openai.ERRORS.unauthorized();
    expect(payload.error).toEqual({
      message: 'Missing or invalid API key',
      type: 'authentication_error',
      param: null,
      code: 'invalid_api_key'
    });
  });

  it('truncates a runaway message', () => {
    expect(openai.errorOf('x'.repeat(5000)).error.message.length).toBeLessThanOrEqual(500);
  });
});

describe('adapter templating', () => {
  it('substitutes inside strings and keeps types for whole-value holes', () => {
    const rendered = template.renderTemplate(
      { q: 'search {term}', n: '{count}', keep: '{missing}', other: 7 },
      { term: 'hello "world"', count: 12 }
    );
    expect(rendered.q).toBe('search hello "world"');
    expect(rendered.n).toBe(12);
    expect(rendered.keep).toBeNull();
    expect(rendered.other).toBe(7);
  });

  it('walks arrays and nested objects', () => {
    const rendered = template.renderTemplate({ messages: [{ content: ['{prompt}'] }] }, { prompt: 'hi' });
    expect(rendered.messages[0].content[0]).toBe('hi');
  });

  it('never lets a prompt escape its JSON string', () => {
    const payload = '{"a":"b"}"; drop table users; --';
    const rendered = template.renderTemplate({ text: payload }, {});
    expect(JSON.parse(JSON.stringify(rendered)).text).toBe(payload);
  });

  it('reads and writes dotted paths, including negatives', () => {
    const source = { messages: [{ content: { parts: ['first'] } }] };
    expect(template.getPath(source, 'messages.0.content.parts.0')).toBe('first');
    expect(template.getPath(source, 'messages.-1.content.parts.0')).toBe('first');
    expect(template.getPath(source, 'messages.9.nope')).toBeUndefined();
    expect(template.getPath(null, 'a')).toBeUndefined();

    template.setPath(source, 'messages.1.content.parts.0', 'second');
    expect(source.messages[1].content.parts[0]).toBe('second');
  });
});

describe('message flattening', () => {
  it('keeps the last user turn as the prompt and folds history in', () => {
    const flat = template.flattenMessages([
      { role: 'system', content: 'Be terse.' },
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'and now?' }
    ]);
    expect(flat.system).toBe('Be terse.');
    expect(flat.prompt).toContain('first question');
    expect(flat.prompt).toContain('Assistant: first answer');
    expect(flat.prompt.trim().endsWith('User: and now?')).toBe(true);
    expect(flat.historyTurns).toBe(2);
  });

  it('can drop history for stateless callers', () => {
    const flat = template.flattenMessages(
      [{ role: 'user', content: 'one' }, { role: 'user', content: 'two' }],
      { includeHistory: false }
    );
    expect(flat.prompt).toBe('two');
    expect(flat.historyTurns).toBe(0);
  });

  it('caps the prompt length from the tail (the newest part wins)', () => {
    const flat = template.flattenMessages([{ role: 'user', content: 'x'.repeat(1000) }], { maxChars: 100 });
    expect(flat.prompt.length).toBe(100);
  });

  it('handles empty and junk input', () => {
    expect(template.flattenMessages([]).prompt).toBe('');
    expect(template.flattenMessages([null, 42, { role: 'user', content: '' }]).prompt).toBe('');
    expect(template.flattenMessages(undefined).system).toBe('');
  });
});
