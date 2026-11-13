import { describe, it, expect } from 'vitest';
import { normalizeName } from '../src/core/normalize.js';

describe('normalizeName', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeName('  Modest   Mouse ')).toBe('modest mouse');
  });

  it('treats & and "and" as the same word', () => {
    expect(normalizeName('Uncle Acid & the Deadbeats')).toBe(normalizeName('Uncle Acid and the Deadbeats'));
    expect(normalizeName('Sam & Louise Sullivan')).toBe(normalizeName('Sam and Louise Sullivan'));
    expect(normalizeName('Mo Lowda&The Humble')).toBe('mo lowda and the humble');
  });

  it('drops a leading "the" but not an inner one or a lone "The"', () => {
    expect(normalizeName('The Notwist')).toBe('notwist');
    expect(normalizeName('the notwist')).toBe('notwist');
    expect(normalizeName('Uncle Acid & the Deadbeats')).toBe('uncle acid and the deadbeats');
    expect(normalizeName('The')).toBe('the');
    expect(normalizeName('Theatre of Hate')).toBe('theatre of hate');
  });

  it('removes diacritics', () => {
    expect(normalizeName('Beyoncé')).toBe('beyonce');
    expect(normalizeName('La Sécurité')).toBe('la securite');
    expect(normalizeName('JÜN')).toBe('jun');
    expect(normalizeName('Sigur Rós')).toBe('sigur ros');
    expect(normalizeName('Mø')).toBe('mo');
    expect(normalizeName('Motörhead')).toBe(normalizeName('Motorhead'));
  });

  it('folds letters that NFKD leaves alone', () => {
    expect(normalizeName('Łukasz')).toBe('lukasz');
    expect(normalizeName('Weiß')).toBe('weiss');
    expect(normalizeName('Cœur')).toBe('coeur');
  });

  it('ignores punctuation-only differences', () => {
    expect(normalizeName('Fat, Evil Children')).toBe(normalizeName('Fat Evil Children'));
    expect(normalizeName('almost a.m.')).toBe(normalizeName('Almost AM'));
    expect(normalizeName('DLG.')).toBe('dlg');
    expect(normalizeName("Guns N' Roses")).toBe(normalizeName('Guns N Roses'));
    expect(normalizeName('Guns N’ Roses')).toBe(normalizeName("Guns N' Roses"));
    expect(normalizeName('Jay-Z')).toBe(normalizeName('Jay Z'));
    expect(normalizeName('hey, nothing')).toBe('hey nothing');
  });

  it('keeps digits', () => {
    expect(normalizeName('Sum 41')).toBe('sum 41');
    expect(normalizeName('2Pac')).toBe('2pac');
  });

  it('keeps CJK, Cyrillic, Greek, Arabic and Hangul letters', () => {
    expect(normalizeName('宇多田ヒカル')).toBe('宇多田ヒカル');
    expect(normalizeName('Кино')).toBe('кино');
    expect(normalizeName('ЦОЙ')).toBe('цои'); // й loses its breve like any accented letter
    expect(normalizeName('Αφροδίτη')).toBe('αφροδιτη');
    expect(normalizeName('فيروز')).toBe('فيروز');
    expect(normalizeName('방탄소년단')).toBe('방탄소년단');
    expect(normalizeName('ＢＴＳ')).toBe('bts');
  });

  it('keeps combining marks that carry meaning (kana dakuten, Devanagari)', () => {
    expect(normalizeName('がらくた')).not.toBe(normalizeName('からくた'));
    expect(normalizeName('हिन्दी')).toContain('ह');
    expect(normalizeName('हिन्दी').length).toBeGreaterThan(3);
  });

  it('does not collapse punctuation- or symbol-only names to empty', () => {
    expect(normalizeName('!!!')).toBe('!!!');
    expect(normalizeName('???')).toBe('???');
    expect(normalizeName('!!!')).not.toBe(normalizeName('???'));
    expect(normalizeName('🎸')).toBe('🎸');
  });

  it('returns an empty string for empty, whitespace or nullish input', () => {
    expect(normalizeName('')).toBe('');
    expect(normalizeName('   \t ')).toBe('');
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(undefined)).toBe('');
  });

  it('is idempotent', () => {
    for (const n of ['The Beyoncé & Co.', 'Mø', '!!!', '宇多田ヒカル', 'Guns N’ Roses', "Wu-Tang Clan"]) {
      expect(normalizeName(normalizeName(n))).toBe(normalizeName(n));
    }
  });
});
