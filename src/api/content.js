/**
 * Content classification (pure).
 *
 * An assistant answer is rarely one blob of prose: it mixes reasoning the model
 * shows you, fenced code, links it cites, tables and lists. Clients built for
 * the OpenAI wire format only understand `content`, so that stays intact — and
 * beside it we describe *what* the answer is made of:
 *
 *   segments  — the answer split into typed blocks, in order
 *   links     — every URL referenced, with its label
 *   code      — every fenced block, with its language
 *   thinking  — the reasoning text, also mirrored to `reasoning_content`
 *              (the de-facto field reasoning UIs already look for)
 *
 * Streaming gets the same treatment incrementally: `createStreamSegmenter()`
 * accumulates deltas and reports the segment a delta belongs to, so a client
 * can render code, reasoning and links while the answer is still arriving.
 */

const SEGMENT_TYPES = {
  THINKING: 'thinking',
  CODE: 'code',
  LINK: 'link',
  TABLE: 'table',
  LIST: 'list',
  HEADING: 'heading',
  QUOTE: 'quote',
  TEXT: 'text'
};

/** Tags models emit around their reasoning. */
const THINKING_TAGS = ['thinking', 'think', 'reasoning', 'reason', 'thought', 'analysis', 'reflection'];

const OPEN_RE = new RegExp(`<\\s*(${THINKING_TAGS.join('|')})\\s*[^>]*>`, 'i');
const CLOSE_RE = new RegExp(`<\\s*/\\s*(${THINKING_TAGS.join('|')})\\s*>`, 'i');

/** Bare URL (stop at punctuation that is far more likely to be prose). */
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()[\]{}"'`]+/gi;
/** Markdown link: `[label](url "title")`. */
const MD_LINK_RE = /\[([^\]]{0,400})\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const HEADING_RE = /^\s{0,3}#{1,6}\s+\S/;
const QUOTE_RE = /^\s{0,3}>\s?/;
const LIST_RE = /^\s*([-*+•]|\d+[.)])\s+\S/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
/** A separator row inside a markdown table. */
const TABLE_DIVIDER_RE = /^\s*\|?[\s:-]*-[\s|:-]*\|?\s*$/;

function trimTrailingPunctuation(url) {
  let value = String(url || '');
  while (value && /[.,;:!?)\]}'"]$/.test(value)) value = value.slice(0, -1);
  return value;
}

function isTableRow(line) {
  return TABLE_ROW_RE.test(line) && line.indexOf('|') !== line.lastIndexOf('|');
}

function isTableDivider(line) {
  return TABLE_DIVIDER_RE.test(line) && line.includes('-');
}

/**
 * Split prose into text + link segments (markdown links first, then bare URLs).
 * @returns {{type: string, text: string, url?: string, label?: string}[]}
 */
function splitLinks(text) {
  const out = [];
  let cursor = 0;

  const pushText = (value) => {
    if (!value) return;
    const last = out[out.length - 1];
    if (last && last.type === SEGMENT_TYPES.TEXT) last.text += value;
    else out.push({ type: SEGMENT_TYPES.TEXT, text: value });
  };

  const pushLink = (url, label) => {
    out.push({ type: SEGMENT_TYPES.LINK, text: label || url, url, label: label || '' });
  };

  const pattern = new RegExp(`${MD_LINK_RE.source}|${URL_RE.source}`, 'gi');
  let match = pattern.exec(text);
  while (match !== null) {
    pushText(text.slice(cursor, match.index));
    const [raw] = match;
    if (match[1] !== undefined) {
      pushLink(trimTrailingPunctuation(match[2]), match[1]);
    } else {
      const url = trimTrailingPunctuation(raw);
      pushLink(url.startsWith('www.') ? `https://${url}` : url, '');
    }
    cursor = match.index + raw.length;
    match = pattern.exec(text);
  }
  pushText(text.slice(cursor));

  return out;
}

/**
 * Split an assistant answer into typed segments.
 *
 * @param {string} text raw answer
 * @returns {{type: string, text: string, language?: string, url?: string,
 *            label?: string, start: number, end: number, index: number}[]}
 */
function segmentContent(text) {
  const source = typeof text === 'string' ? text.replace(/\r\n/g, '\n') : '';
  if (!source.trim()) return [];

  const lines = source.split('\n');
  const segments = [];
  let buffer = [];
  let bufferType = null;
  let bufferLanguage = null;
  let offset = 0;

  const flush = () => {
    if (!bufferType) return;
    const value = buffer.join('\n');
    const start = offset;
    const end = start + value.length;

    if (bufferType === SEGMENT_TYPES.TEXT) {
      for (const part of splitLinks(value)) {
        segments.push({
          type: part.type,
          text: part.text,
          ...(part.url ? { url: part.url, label: part.label || '' } : {}),
          start,
          end,
          index: segments.length
        });
      }
    } else {
      segments.push({
        type: bufferType,
        text: value,
        ...(bufferLanguage ? { language: bufferLanguage } : {}),
        start,
        end,
        index: segments.length
      });
    }

    buffer = [];
    bufferType = null;
    bufferLanguage = null;
  };

  const startBlock = (type, language = null) => {
    flush();
    bufferType = type;
    bufferLanguage = language;
    buffer = [];
  };

  /** Emit a complete block right away (used for inline `<think>…</think>`). */
  const addBlock = (type, lines, language = null) => {
    flush();
    bufferType = type;
    bufferLanguage = language;
    buffer = lines;
    flush();
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // Keep `offset` in sync with the original string so `start`/`end` are real.
    const lineStart = offset;
    offset += line.length + 1;

    // --- fenced code ------------------------------------------------------
    const fence = line.match(FENCE_RE);
    if (fence) {
      if (bufferType === SEGMENT_TYPES.CODE) {
        buffer.push(line);
        flush();
      } else {
        startBlock(SEGMENT_TYPES.CODE, fence[2] || '');
        buffer.push(line);
      }
      continue;
    }
    if (bufferType === SEGMENT_TYPES.CODE) {
      buffer.push(line);
      continue;
    }

    // --- reasoning blocks -------------------------------------------------
    const opening = line.match(OPEN_RE);
    const closing = line.match(CLOSE_RE);

    // `<think>…</think>` on one line: the whole reasoning sits inline.
    if (opening && closing && closing.index > opening.index) {
      const before = line.slice(0, opening.index);
      const inner = line.slice(opening.index + opening[0].length, closing.index);
      const after = line.slice(closing.index + closing[0].length);
      if (before.trim()) {
        if (bufferType !== SEGMENT_TYPES.TEXT) startBlock(SEGMENT_TYPES.TEXT);
        buffer.push(before);
      }
      addBlock(SEGMENT_TYPES.THINKING, inner.trim() ? [inner] : []);
      if (after.trim()) {
        startBlock(SEGMENT_TYPES.TEXT);
        buffer.push(after);
      }
      continue;
    }

    if (opening) {
      const before = line.slice(0, opening.index);
      const after = line.slice(opening.index + opening[0].length);
      if (before.trim()) {
        if (bufferType !== SEGMENT_TYPES.TEXT) startBlock(SEGMENT_TYPES.TEXT);
        buffer.push(before);
        flush();
      }
      startBlock(SEGMENT_TYPES.THINKING);
      if (after.trim()) buffer.push(after);
      continue;
    }
    if (bufferType === SEGMENT_TYPES.THINKING) {
      const closing = line.match(CLOSE_RE);
      if (closing) {
        const before = line.slice(0, closing.index);
        if (before.trim()) buffer.push(before);
        flush();
        const after = line.slice(closing.index + closing[0].length);
        if (after.trim()) {
          startBlock(SEGMENT_TYPES.TEXT);
          buffer.push(after);
        }
        continue;
      }
      buffer.push(line);
      continue;
    }

    // --- block level markdown ---------------------------------------------
    const type = isTableRow(line)
      ? SEGMENT_TYPES.TABLE
      : HEADING_RE.test(line)
        ? SEGMENT_TYPES.HEADING
        : QUOTE_RE.test(line)
          ? SEGMENT_TYPES.QUOTE
          : LIST_RE.test(line)
            ? SEGMENT_TYPES.LIST
            : SEGMENT_TYPES.TEXT;

    if (bufferType !== type) {
      // A table divider belongs to the table it follows; a blank line does not
      // break a list, so lists stay one segment across paragraphs.
      if (type === SEGMENT_TYPES.TABLE && isTableDivider(line) && bufferType === SEGMENT_TYPES.TABLE) {
        buffer.push(line);
        continue;
      }
      if (!line.trim() && (bufferType === SEGMENT_TYPES.LIST || bufferType === SEGMENT_TYPES.QUOTE)) {
        buffer.push(line);
        continue;
      }
      startBlock(type);
    }
    buffer.push(line);
    void lineStart;
  }

  flush();

  // Trim the trailing newline we added to the last segment.
  const last = segments[segments.length - 1];
  if (last && last.text.endsWith('\n')) last.text = last.text.replace(/\n+$/, '');

  return segments.filter((segment) => segment.text !== '' || segment.type === SEGMENT_TYPES.LINK);
}

/** Counts, links, code blocks and reasoning pulled out of a segment list. */
function summariseSegments(segments) {
  const list = Array.isArray(segments) ? segments : [];
  const counts = {};
  const links = [];
  const code = [];
  const thinking = [];

  for (const segment of list) {
    counts[segment.type] = (counts[segment.type] || 0) + 1;
    if (segment.type === SEGMENT_TYPES.LINK && segment.url) {
      if (!links.some((entry) => entry.url === segment.url)) links.push({ url: segment.url, label: segment.label || '' });
    }
    if (segment.type === SEGMENT_TYPES.CODE) {
      code.push({ language: segment.language || '', text: segment.text });
    }
    if (segment.type === SEGMENT_TYPES.THINKING) thinking.push(segment.text);
  }

  const reasoning = thinking.join('\n\n').trim();

  return {
    types: counts,
    links,
    code,
    thinking: reasoning,
    hasThinking: Boolean(reasoning),
    hasCode: code.length > 0,
    hasLinks: links.length > 0
  };
}

/** One-shot helper: classify a whole answer. */
function analyzeContent(text) {
  const segments = segmentContent(text);
  return { segments, ...summariseSegments(segments) };
}

/**
 * Incremental classifier for streaming answers.
 *
 * `push(delta)` returns the segment the delta landed in plus any boundary
 * events, so the caller can annotate streamed chunks without waiting for the
 * final answer. Re-segmenting the accumulated text is O(n) per delta; answers
 * are capped well below the point where that matters.
 */
function createStreamSegmenter({ maxChars = 400000 } = {}) {
  let text = '';
  let segments = [];
  let current = { type: SEGMENT_TYPES.TEXT, index: 0 };
  // Two block states span deltas, so they are tracked as we go: a token that
  // lands inside a fence or inside `<think>` belongs to that block, whatever
  // the last full parse said.
  let inFence = false;
  let inThinking = false;
  let overflow = false;

  return {
    push(delta) {
      const chunk = typeof delta === 'string' ? delta : '';
      if (!chunk) return { type: current.type, events: [], index: current.index };
      const before = text.length;
      if (before < maxChars) text += chunk;
      else overflow = true;
      if (overflow) return { type: current.type, events: [], index: current.index, overflow: true };

      if (inThinking) {
        // Inside a reasoning block a close tag ends it wherever it lands; the
        // rest of the chunk (if any) is prose after the tag.
        if (CLOSE_RE.test(chunk)) inThinking = false;
      } else {
        const pieces = chunk.split('\n');
        for (let i = 0; i < pieces.length; i += 1) {
          // Only a line *start* opens a block: a fence mid-sentence is prose
          // ("use ``` for code"), not a code block.
          const startsLine = i > 0 || before === 0 || text[before - 1] === '\n';
          if (!startsLine) continue;
          const line = pieces[i];
          if (OPEN_RE.test(line) && !CLOSE_RE.test(line)) {
            inThinking = true;
            break;
          }
          if (FENCE_RE.test(line)) inFence = !inFence;
        }
      }

      const next = segmentContent(text);
      const previous = segments;
      segments = next;

      const events = [];
      for (let index = previous.length; index < next.length; index += 1) {
        events.push({ kind: 'start', segment: describe(next[index]) });
      }
      for (const segment of previous.slice(next.length)) {
        if (segment.text.trim()) events.push({ kind: 'end', segment: describe(segment, next.length) });
      }

      let type = SEGMENT_TYPES.TEXT;
      let index = Math.max(0, next.length - 1);
      if (inThinking) {
        type = SEGMENT_TYPES.THINKING;
      } else if (inFence) {
        type = SEGMENT_TYPES.CODE;
      } else {
        // Outside a fence, a trailing code segment means the block just closed:
        // from here on the answer is prose again.
        const last = next[next.length - 1];
        if (
          last &&
          (last.type === SEGMENT_TYPES.TABLE ||
            last.type === SEGMENT_TYPES.LIST ||
            last.type === SEGMENT_TYPES.HEADING ||
            last.type === SEGMENT_TYPES.QUOTE)
        ) {
          type = last.type;
          index = last.index;
        }
      }

      if (current.type !== type) current = { type, index };
      else current.index = index;

      return { type: current.type, events, index: current.index, overflow: false };
    },
    /** Final classification of everything received so far. */
    finish() {
      const segments_ = segmentContent(text);
      return { segments: segments_, ...summariseSegments(segments_) };
    },
    get text() {
      return text;
    }
  };
}

function describe(segment, index = segment.index) {
  return {
    type: segment.type,
    index: typeof index === 'number' ? index : segment.index,
    ...(segment.language ? { language: segment.language } : {}),
    ...(segment.url ? { url: segment.url } : {})
  };
}

module.exports = {
  SEGMENT_TYPES,
  THINKING_TAGS,
  segmentContent,
  summariseSegments,
  analyzeContent,
  createStreamSegmenter,
  splitLinks
};
