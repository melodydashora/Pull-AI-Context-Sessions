// The arithmetic of the windowed session list (docs/design.md 4.7.5). The rows are cut into
// chunks; only the chunks near the visible part of the list are drawn, and every other chunk is
// an empty element as high as the chunk was when it was last drawn, or an estimate until then.
// Nothing here touches the page: SessionList.tsx measures and draws.

/** Rows per chunk. A chunk is the unit that is drawn or left out. */
export const CHUNK_ROWS = 50;
/** The height of a row until its chunk has been drawn once (design.md 4.7.5: 64 to about 110 px). */
export const ROW_ESTIMATE_PX = 88;
/** How far outside the visible part of the list a chunk is drawn already. */
export const NEAR_MARGIN_PX = 1200;

/** Chunks `first` to `last`, both included. `first` is -1 when there is none. */
export interface ChunkRange {
  readonly first: number;
  readonly last: number;
}

export const NO_CHUNK: ChunkRange = { first: -1, last: -1 };

export function chunkCount(rows: number): number {
  return Math.ceil(rows / CHUNK_ROWS);
}

/** How many rows the chunk `index` holds in a list of `rows` rows. */
export function rowsInChunk(rows: number, index: number): number {
  return Math.max(0, Math.min(CHUNK_ROWS, rows - index * CHUNK_ROWS));
}

/** The chunk that holds the row at `position` (0 for the first row), or -1 for a position that is none. */
export function chunkOfRow(position: number): number {
  return position < 0 ? -1 : Math.floor(position / CHUNK_ROWS);
}

/**
 * The chunks that lie at least partly between `from` and `to`, both measured in px from the top
 * of the list, when chunk `index` is `heightOf(index)` px high. They are always neighbours.
 */
export function chunksBetween(
  count: number,
  heightOf: (index: number) => number,
  from: number,
  to: number,
): ChunkRange {
  let top = 0;
  let first = -1;
  let last = -1;
  for (let index = 0; index < count; index++) {
    const height = heightOf(index);
    if (top + height > from && top < to) {
      if (first === -1) first = index;
      last = index;
    } else if (first !== -1) {
      break;
    }
    top += height;
  }
  return first === -1 ? NO_CHUNK : { first, last };
}

export function sameRange(a: ChunkRange, b: ChunkRange): boolean {
  return a.first === b.first && a.last === b.last;
}
