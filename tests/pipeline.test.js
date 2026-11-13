import { describe, it, expect } from 'vitest';
import { parseLineupHtml, decodeEntities, parseRetryAfter, stripTags } from '../scripts/lib/lineup-pipeline.js';

const card = (name, cls = 'lineup-artist-name') => `<div class="card"><h3 class="${cls}">${name}</h3></div>`;

describe('decodeEntities', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeEntities('Beyond &amp; Back &#8211; &#x2019;s &quot;x&quot; &lt;3')).toBe('Beyond & Back – ’s "x" <3');
  });
  it('leaves unknown entities alone', () => {
    expect(decodeEntities('&bogus; &#99999999999;')).toBe('&bogus; &#99999999999;');
  });
});

describe('parseLineupHtml', () => {
  const html = [
    '<h3 class="elementor-heading">Not an artist</h3>',
    card('Modest Mouse'),
    card('Beyond &amp; Back'),
    '<h3 class="x lineup-artist-name y"><span>Nested</span> <b>Tags</b></h3>',
    card('modest mouse'),
    card('  Spaced \n  Out  '),
    card('   '),
  ].join('\n');

  it('extracts only artist cards, decoded, in page order', () => {
    expect(parseLineupHtml(html)).toEqual(['Modest Mouse', 'Beyond & Back', 'Nested Tags', 'Spaced Out']);
  });
  it('de-duplicates case-insensitively keeping the first spelling', () => {
    expect(parseLineupHtml(html)).not.toContain('modest mouse');
  });
  it('returns an empty list for unrelated markup', () => {
    expect(parseLineupHtml('<h3>Hello</h3>')).toEqual([]);
  });
});

describe('parseRetryAfter', () => {
  it('parses seconds', () => expect(parseRetryAfter('7')).toBe(7));
  it('parses HTTP dates', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:30 GMT', now)).toBe(30);
  });
  it('returns null when absent or invalid', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
  });
});

describe('stripTags', () => {
  it('removes tags and keeps the text', () => {
    expect(stripTags('<span class="x">A <b>&amp;</b> B</span>')).toBe('A &amp; B');
  });
  it('leaves no angle bracket behind when removing a tag splices a new one together', () => {
    expect(stripTags('<scr<b>ipt>alert(1)</scr</b>ipt>')).not.toMatch(/[<>]/);
    expect(stripTags('a < b > c')).toBe('a  c');
    expect(stripTags('<<i>script>x')).not.toContain('<');
  });
  it('does not decode entities (that happens afterwards)', () => {
    expect(stripTags('&lt;script&gt;')).toBe('&lt;script&gt;');
  });
});

describe('parseLineupHtml with hostile markup', () => {
  it('never yields a name containing a tag', () => {
    const html = '<h3 class="lineup-artist-name"><scr<b>ipt>Evil</scr</b>ipt> Band</h3>';
    for (const name of parseLineupHtml(html)) expect(name).not.toMatch(/[<>]/);
  });
});
