type RandomSource = () => number;

const FIRST_YEAR = 1993;
const LAST_YEAR = 2026;

function randomIndex(length: number, rng: RandomSource): number {
  const value = rng();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('The random source must return a number from 0 (inclusive) to 1 (exclusive).');
  }
  return Math.floor(value * length);
}

function shuffled<T>(values: T[], rng: RandomSource): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = randomIndex(index + 1, rng);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

/** Tile values are their correct zero-based positions in the original photo. */
export function shuffledTiles(size: number, rng: RandomSource = Math.random): number[] {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new RangeError('Puzzle size must be a non-negative safe integer.');
  }
  const tiles = shuffled(Array.from({ length: size }, (_, index) => index), rng);
  // An identity shuffle is possible, especially with two tiles. Never open a
  // playable puzzle already solved, and avoid retry loops with a fixed RNG.
  if (size > 1 && isPuzzleSolved(tiles)) {
    [tiles[0], tiles[1]] = [tiles[1], tiles[0]];
  }
  return tiles;
}

/** Swap two selected positions without modifying the caller's game state. */
export function swapTiles(tiles: number[], a: number, b: number): number[] {
  if (![a, b].every((index) => Number.isInteger(index) && index >= 0 && index < tiles.length)) {
    throw new RangeError('Tile positions must be integer indices inside the puzzle.');
  }
  const result = [...tiles];
  [result[a], result[b]] = [result[b], result[a]];
  return result;
}

/** An empty board is not a completed photo puzzle. */
export function isPuzzleSolved(tiles: number[]): boolean {
  return tiles.length > 0 && tiles.every((tile, index) => tile === index);
}

export function correctTileCount(tiles: number[]): number {
  return tiles.reduce((count, tile, index) => count + Number(tile === index), 0);
}

/** Four distinct chronological choices, including the photograph's real year. */
export function yearChoices(
  correct: number,
  availableYears: number[],
  rng: RandomSource = Math.random,
): number[] {
  if (!Number.isInteger(correct) || correct < FIRST_YEAR || correct > LAST_YEAR) {
    throw new RangeError(`The photograph year must be an integer from ${FIRST_YEAR} to ${LAST_YEAR}.`);
  }
  const candidates = [...new Set(availableYears)].filter((year) => (
    Number.isInteger(year) && year >= FIRST_YEAR && year <= LAST_YEAR && year !== correct
  ));
  const choices = new Set([correct, ...shuffled(candidates, rng).slice(0, 3)]);

  // Sparse archives still make a complete question. Fill with the closest
  // valid years, rather than inventing implausible dates or duplicate choices.
  for (let distance = 1; choices.size < 4; distance += 1) {
    for (const year of [correct - distance, correct + distance]) {
      if (year >= FIRST_YEAR && year <= LAST_YEAR) choices.add(year);
      if (choices.size === 4) break;
    }
  }
  return [...choices].sort((a, b) => a - b);
}
