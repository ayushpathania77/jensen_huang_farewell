import assert from 'node:assert/strict';
import test from 'node:test';
import { correctTileCount, isPuzzleSolved, shuffledTiles, swapTiles, yearChoices } from '../src/lib/photo-games.js';

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test('shuffled puzzles preserve every tile exactly once and start unsolved', () => {
  for (const size of [2, 3, 9, 16, 25]) {
    const expected = Array.from({ length: size }, (_, index) => index);
    for (let seed = 0; seed < 100; seed += 1) {
      const tiles = shuffledTiles(size, seededRandom(seed));
      assert.deepEqual([...tiles].sort((a, b) => a - b), expected);
      assert.equal(isPuzzleSolved(tiles), false);
    }
  }
});

test('an identity shuffle is repaired without retrying the random source', () => {
  let calls = 0;
  const tiles = shuffledTiles(9, () => { calls += 1; return 0.999999; });
  assert.equal(calls, 8);
  assert.deepEqual(tiles, [1, 0, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(shuffledTiles(2, () => 0.999999), [1, 0]);
});

test('empty and single-tile boards are handled explicitly; invalid sizes fail', () => {
  assert.deepEqual(shuffledTiles(0), []);
  assert.deepEqual(shuffledTiles(1), [0]);
  assert.equal(isPuzzleSolved([]), false);
  assert.equal(isPuzzleSolved([0]), true);
  for (const size of [-1, 1.5, NaN, Infinity]) {
    assert.throws(() => shuffledTiles(size), RangeError);
  }
});

test('swapping is immutable and the inverse swap restores the original board', () => {
  const original = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  Object.freeze(original);
  const swapped = swapTiles(original, 0, 8);
  assert.deepEqual(swapped, [8, 1, 2, 3, 4, 5, 6, 7, 0]);
  assert.deepEqual(original, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.notEqual(swapped, original);
  assert.deepEqual(swapTiles(swapped, 8, 0), original);
  const unchanged = swapTiles(original, 4, 4);
  assert.deepEqual(unchanged, original);
  assert.notEqual(unchanged, original);
});

test('out-of-bounds and non-integer swaps fail without changing the board', () => {
  const original = [2, 0, 1];
  for (const index of [-1, 3, 100, 0.5, NaN, Infinity]) {
    assert.throws(() => swapTiles(original, index, 0), RangeError);
    assert.throws(() => swapTiles(original, 0, index), RangeError);
  }
  assert.throws(() => swapTiles([], 0, 0), RangeError);
  assert.deepEqual(original, [2, 0, 1]);
});

test('solved detection and progress reflect the positions rather than distinct values alone', () => {
  assert.equal(isPuzzleSolved([0, 1, 2, 3]), true);
  assert.equal(correctTileCount([0, 1, 2, 3]), 4);
  assert.equal(isPuzzleSolved([0, 2, 1, 3]), false);
  assert.equal(correctTileCount([0, 2, 1, 3]), 2);
  assert.equal(correctTileCount([2, 0, 1]), 0);
  assert.equal(correctTileCount([]), 0);
  assert.equal(isPuzzleSolved([0, 0, 2]), false);
});

test('year choices include the answer, stay distinct and sorted, and preserve the archive', () => {
  const available = [2006, 2010, 2014, 2016, 2018, 2022, 2023, 2025, 2026, 2014];
  const snapshot = [...available];
  Object.freeze(available);
  for (let seed = 0; seed < 100; seed += 1) {
    for (const correct of [2006, 2014, 2026]) {
      const choices = yearChoices(correct, available, seededRandom(seed));
      assert.equal(choices.length, 4);
      assert.equal(new Set(choices).size, 4);
      assert.ok(choices.includes(correct));
      assert.deepEqual(choices, [...choices].sort((a, b) => a - b));
      assert.ok(choices.every((year) => available.includes(year)));
    }
  }
  assert.deepEqual(available, snapshot);
});

test('sparse year choices use nearby dates and stay inside the album period', () => {
  assert.deepEqual(yearChoices(2014, [2014, 2014]), [2012, 2013, 2014, 2015]);
  assert.deepEqual(yearChoices(1993, []), [1993, 1994, 1995, 1996]);
  assert.deepEqual(yearChoices(2026, []), [2023, 2024, 2025, 2026]);
  assert.deepEqual(yearChoices(2014, [1900, 2030, NaN, 2014.5]), [2012, 2013, 2014, 2015]);
  const choices = yearChoices(2014, [2006]);
  assert.ok(choices.includes(2006));
  assert.ok(choices.includes(2014));
  assert.equal(choices.length, 4);
  for (const correct of [1992, 2027, 2014.5, NaN]) {
    assert.throws(() => yearChoices(correct, []), RangeError);
  }
});

test('invalid injected random values cannot corrupt tiles or answer choices', () => {
  for (const value of [-0.1, 1, NaN, Infinity]) {
    assert.throws(() => shuffledTiles(9, () => value), RangeError);
    assert.throws(() => yearChoices(2014, [2006, 2010, 2026], () => value), RangeError);
  }
});
