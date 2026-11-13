import { describe, it, expect } from 'vitest';
import { cleanPlatformUrl, isAllowedUrlForAnyPlatform } from '../src/core/link-hosts.js';

describe('cleanPlatformUrl', () => {
  it('accepts https on the platform host and strips the fragment', () => {
    expect(cleanPlatformUrl('spotify', 'https://open.spotify.com/artist/abc#x')).toBe('https://open.spotify.com/artist/abc');
    expect(cleanPlatformUrl('bandcamp', 'https://some-band1.bandcamp.com/')).toBe('https://some-band1.bandcamp.com/');
  });
  it('rejects other schemes, hosts, credentials, ports, look-alikes and bare roots', () => {
    for (const [p, u] of [
      ['spotify', 'http://open.spotify.com/artist/abc'],
      ['spotify', 'https://open.spotify.com.evil.example/artist/abc'],
      ['spotify', 'https://evil.example/open.spotify.com'],
      ['spotify', 'https://open.spotify.com/'],
      ['spotify', 'https://a:b@open.spotify.com/artist/x'],
      ['spotify', 'https://open.spotify.com:8443/artist/x'],
      ['bandcamp', 'https://bandcamp.com/'],
      ['bandcamp', 'https://x.bandcamp.com.evil.example/'],
      ['bandcamp', 'https://-x.bandcamp.com/'],
      ['tidal', 'https://tidal.com.evil.example/artist/1'],
      ['youtube', 'https://music.youtube.com/channel/x'],
      ['spotify', 'javascript:alert(1)'],
      ['spotify', 'not a url'],
      ['myspace', 'https://myspace.com/x'],
    ]) expect(cleanPlatformUrl(p, u), `${p} ${u}`).toBeNull();
    expect(cleanPlatformUrl('spotify', 42)).toBeNull();
    expect(cleanPlatformUrl('spotify', null)).toBeNull();
  });
  it('isAllowedUrlForAnyPlatform', () => {
    expect(isAllowedUrlForAnyPlatform('https://www.last.fm/music/X')).toBe(true);
    expect(isAllowedUrlForAnyPlatform('https://example.com/')).toBe(false);
  });
});
