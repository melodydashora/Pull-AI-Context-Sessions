// The arithmetic of the windowed session list (docs/design.md 4.7.5).

import { expect, it } from "vitest";
import {
  CHUNK_ROWS,
  chunkCount,
  chunkOfRow,
  chunksBetween,
  NO_CHUNK,
  rowsInChunk,
  sameRange,
} from "./windowing.ts";

it("cuts a list into chunks of 50 rows, the last one shorter", () => {
  expect(CHUNK_ROWS).toBe(50);
  expect([0, 1, 50, 51, 120, 40_000].map(chunkCount)).toEqual([0, 1, 1, 2, 3, 800]);
  expect([0, 1, 2, 3].map((index) => rowsInChunk(120, index))).toEqual([50, 50, 20, 0]);
  expect(rowsInChunk(50, 0)).toBe(50);
  expect(rowsInChunk(50, 1)).toBe(0);
  expect([0, 49, 50, 119].map(chunkOfRow)).toEqual([0, 0, 1, 2]);
  expect(chunkOfRow(-1)).toBe(-1);
});

it("finds the chunks that lie at least partly between two heights", () => {
  const even = (): number => 1000;
  // The band 0 to 800: only the first chunk.
  expect(chunksBetween(10, even, 0, 800)).toEqual({ first: 0, last: 0 });
  // A band that begins above the list: the list starts at its top.
  expect(chunksBetween(10, even, -1200, 2000)).toEqual({ first: 0, last: 1 });
  // In the middle, touching three chunks.
  expect(chunksBetween(10, even, 2500, 4200)).toEqual({ first: 2, last: 4 });
  // A chunk that only touches the band with its edge is not in it.
  expect(chunksBetween(10, even, 2000, 3000)).toEqual({ first: 2, last: 2 });
  // Past the end, before the beginning, an empty list.
  expect(chunksBetween(10, even, 10_000, 12_000)).toEqual(NO_CHUNK);
  expect(chunksBetween(10, even, -500, 0)).toEqual(NO_CHUNK);
  expect(chunksBetween(0, even, 0, 800)).toEqual(NO_CHUNK);
});

it("uses the height of each chunk, measured or estimated", () => {
  const heights = [4400, 3200, 5500, 880];
  const heightOf = (index: number): number => heights[index] ?? 0;
  expect(chunksBetween(4, heightOf, 4399, 4401)).toEqual({ first: 0, last: 1 });
  expect(chunksBetween(4, heightOf, 7600, 7700)).toEqual({ first: 2, last: 2 });
  expect(chunksBetween(4, heightOf, 13_099, 20_000)).toEqual({ first: 2, last: 3 });
  expect(chunksBetween(4, heightOf, 13_100, 20_000)).toEqual({ first: 3, last: 3 });
});

it("compares two ranges by their ends", () => {
  expect(sameRange({ first: 1, last: 2 }, { first: 1, last: 2 })).toBe(true);
  expect(sameRange({ first: 1, last: 2 }, { first: 1, last: 3 })).toBe(false);
  expect(sameRange(NO_CHUNK, { first: -1, last: -1 })).toBe(true);
});
