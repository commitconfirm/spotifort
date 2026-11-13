import { describe, it, expect } from 'vitest';
import { ApiError } from '../scripts/lib/http.js';
import { processItems } from '../scripts/lib/stage.js';

describe('processItems', () => {
  it('processes everything and saves at the end', async () => {
    const saves = [];
    const r = await processItems([1, 2, 3], async () => {}, { save: () => saves.push(1), saveEvery: 2 });
    expect(r).toMatchObject({ ok: 3, failed: [], notReached: [], aborted: null });
    expect(saves.length).toBe(2); // after 2 successes and at the end
  });

  it('a failure leaves the item for next time and the run goes on', async () => {
    const done = [];
    const r = await processItems([1, 2, 3], async (x) => {
      if (x === 2) throw new Error('boom');
      done.push(x);
    });
    expect(done).toEqual([1, 3]);
    expect(r.failed).toEqual([{ item: 2, message: 'boom' }]);
    expect(r.aborted).toBeNull();
  });

  it('aborts after N consecutive errors and reports what was not reached', async () => {
    const r = await processItems([1, 2, 3, 4, 5], async () => { throw new Error('down'); }, { maxConsecutiveErrors: 3 });
    expect(r.failed).toHaveLength(3);
    expect(r.notReached).toEqual([4, 5]);
    expect(r.aborted).toMatch(/3 consecutive errors/);
  });

  it('a success resets the streak', async () => {
    const r = await processItems([1, 2, 3, 4, 5], async (x) => { if (x % 2) throw new Error('odd'); }, { maxConsecutiveErrors: 2 });
    expect(r.aborted).toBeNull();
    expect(r.ok).toBe(2);
  });

  it('stops at once on an error that says abort', async () => {
    const r = await processItems([1, 2, 3], async () => { throw new ApiError('rate limited', { abort: true }); });
    expect(r.failed).toHaveLength(1);
    expect(r.notReached).toEqual([2, 3]);
    expect(r.aborted).toBe('rate limited');
  });

  it('still saves when the work throws something unexpected', async () => {
    let saved = 0;
    await processItems([1], async () => { throw new TypeError('bug'); }, { save: () => saved++ });
    expect(saved).toBe(1);
  });
});
