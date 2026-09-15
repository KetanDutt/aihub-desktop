/**
 * Content classification: an answer is not one blob of prose, and the local API
 * says what it is made of.
 */

const content = require('../src/api/content');
const openai = require('../src/api/openai');

describe('segmentContent', () => {
  it('splits reasoning, code, links, lists and prose', () => {
    const text = [
      '<thinking>First I compare the two options.<ing>',
      'Here is the thing:',
      '',
      '```js',
      'const a = 1;',
      '```',
      '',
      '- one',
      '- two',
      '',
      'See [the docs](https://example.com/docs) and https://example.org for more.'
    ].join('\n');

    const segments = content.segmentContent(text);
    const types = segments.map((segment) => segment.type);

    expect(types).toContain('thinking');
    expect(types).toContain('code');
    expect(types).toContain('list');
    expect(types).toContain('link');
    expect(types).toContain('text');
  });

  it('keeps the language of a fenced block', () => {
    const [code] = content.segmentContent('```python\nprint(1)\n```').filter((s) => s.type === 'code');
    expect(code.language).toBe('python');
    expect(code.text).toContain('print(1)');
  });

  it('collects links with their labels', () => {
    const analysis = content.analyzeContent('Read [Docs](https://example.com/a) then https://example.com/b.');
    expect(analysis.links.map((link) => link.url)).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(analysis.links[0].label).toBe('Docs');
    expect(analysis.hasLinks).toBe(true);
  });

  it('recognises markdown tables and headings', () => {
    const segments = content.segmentContent('# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |');
    expect(segments.map((s) => s.type)).toEqual(expect.arrayContaining(['heading', 'table']));
  });

  it('returns nothing for empty answers', () => {
    expect(content.segmentContent('')).toEqual([]);
    expect(content.segmentContent(null)).toEqual([]);
    expect(content.analyzeContent('   ').hasThinking).toBe(false);
  });

  it('summarises counts per type', () => {
    const analysis = content.analyzeContent('text\n\n```js\n1\n```\n\n```js\n2\n```');
    expect(analysis.types.code).toBe(2);
    expect(analysis.code).toHaveLength(2);
  });
});

describe('streamed classification', () => {
  it('reports the segment a delta lands in and announces boundaries', () => {
    const segmenter = content.createStreamSegmenter();
    expect(segmenter.push('Hel').type).toBe('text');
    expect(segmenter.push('lo').type).toBe('text');

    const fence = segmenter.push('\n```js\n');
    expect(fence.type).toBe('code');
    expect(fence.events.length).toBeGreaterThan(0);

    expect(segmenter.push('const a = 1;').type).toBe('code');
    expect(segmenter.push('\n```\n').type).toBe('text');

    const finished = segmenter.finish();
    expect(finished.types.code).toBe(1);
    expect(finished.segments.map((s) => s.type)).toEqual(expect.arrayContaining(['text', 'code']));
  });

  it('routes thinking to reasoning_content through the wire format', () => {
    const segmenter = content.createStreamSegmenter();
    const info = segmenter.push('<thinking>hmm');
    expect(info.type).toBe('thinking');

    const chunk = openai.deltaChunk({ id: 'x', model: 'm', created: 1, text: 'hmm', reasoning: true });
    expect(chunk.choices[0].delta).toEqual({ reasoning_content: 'hmm' });
  });
});

describe('chat completion payload', () => {
  it('keeps content intact and mirrors reasoning into reasoning_content', () => {
    const completion = openai.buildCompletion({
      id: 'chatcmpl-1',
      model: 'aihub/chatgpt',
      created: 1700000000,
      text: '<think>step one</think>\n\nThe answer is 42.'
    });

    expect(completion.choices[0].message.content).toContain('The answer is 42.');
    expect(completion.choices[0].message.reasoning_content).toBe('step one');
    expect(completion.aihub.content.hasThinking).toBe(true);
    expect(completion.aihub.content.types.thinking).toBe(1);
  });

  it('omits reasoning when the answer has none', () => {
    const completion = openai.buildCompletion({ id: '1', model: 'm', created: 1, text: 'plain' });
    expect(completion.choices[0].message.reasoning_content).toBeUndefined();
    expect(completion.aihub.content.hasThinking).toBe(false);
  });

  it('describes code blocks and links in the extension', () => {
    const completion = openai.buildCompletion({
      id: '1',
      model: 'm',
      created: 1,
      text: '```js\nlet a=1;\n```\n\nSee https://example.com'
    });
    expect(completion.aihub.content.hasCode).toBe(true);
    expect(completion.aihub.content.code[0].language).toBe('js');
    expect(completion.aihub.content.links[0].url).toBe('https://example.com');
  });
});
