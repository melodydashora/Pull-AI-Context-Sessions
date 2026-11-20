// Unicode Normalization Form C in bounded time, for the two rules of docs/data-model.md that
// compare text in composed form: search (8.1) and project names (8.4).
//
// The result is exactly that of String.prototype.normalize("NFC"). Called on its own, that method
// sorts a run of combining marks by insertion: 400,000 marks in the wrong order take minutes, and a
// title, a summary or a project name can come from a stranger's file. So a long run is put into
// canonical order here first, in linear time; on a run in order the method itself is linear.
//
// No table of Unicode data is needed: which marks are reordered, and in which direction, is asked
// of the platform with strings of two marks.

/**
 * Combining marks, at most 1024 at a time. Every character that canonical ordering moves is a
 * mark. A quantifier without an upper bound overflows the stack of the regular-expression engine
 * on a run of some millions of marks; pieces that touch are joined in composedForm.
 */
const MARK_PIECES = /\p{M}{1,1024}/gu;

/** Unicode Standard Annex 15, section 13: text is "stream-safe" with at most 30 marks in a row. */
const LONGEST_PLAIN_RUN = 30;

/** Two marks of different combining classes (1 and 240), written as numbers: plain ASCII source. */
const LOW_PROBE = String.fromCodePoint(0x0334);
const HIGH_PROBE = String.fromCodePoint(0x0345);

/** How many code points become text in one call: a bound on the number of arguments. */
const CHUNK = 4096;

/** True when canonical ordering exchanges the two: the class of `first` is the higher one. */
function isReordered(first: string, second: string): boolean {
  const pair = first + second;
  return pair.normalize("NFD") !== pair;
}

/** True for a mark that canonical ordering can move: its class is above one probe or below the other. */
function isNonStarter(mark: string): boolean {
  return isReordered(HIGH_PROBE, mark) || isReordered(mark, LOW_PROBE);
}

function codePointsOf(text: string): number[] {
  const points: number[] = [];
  for (const character of text) points.push(character.codePointAt(0) ?? 0);
  return points;
}

function textOf(points: readonly number[]): string {
  if (points.length <= CHUNK) return String.fromCodePoint(...points);
  const chunks: string[] = [];
  for (let i = 0; i < points.length; i += CHUNK) {
    chunks.push(String.fromCodePoint(...points.slice(i, i + CHUNK)));
  }
  return chunks.join("");
}

/** The rank of the combining class of each of the given marks; a higher class has a higher rank. */
function classRanks(marks: ReadonlySet<number>): Map<number, number> {
  const ranks = new Map<number, number>();
  let previous: string | undefined;
  let rank = 0;
  // The platform sorts the different marks once; there are a few thousand of them at most.
  for (const mark of textOf([...marks]).normalize("NFD")) {
    if (previous !== undefined && isReordered(mark, previous)) rank += 1;
    ranks.set(mark.codePointAt(0) ?? 0, rank);
    previous = mark;
  }
  return ranks;
}

/** A stretch of movable marks in canonical order: a stable sort by combining class. */
function sortedByClass(stretch: readonly number[]): string {
  const ranks = classRanks(new Set(stretch));
  const byRank: number[][] = [];
  for (const mark of stretch) {
    const rank = ranks.get(mark) ?? 0;
    const bucket = byRank[rank] ?? [];
    bucket.push(mark);
    byRank[rank] = bucket;
  }
  const out: string[] = [];
  for (const bucket of byRank) if (bucket !== undefined) out.push(textOf(bucket));
  return out.join("");
}

/**
 * A run of marks, decomposed and with every long stretch of movable marks in canonical order.
 * Canonically equivalent to the run it is given.
 */
function inCanonicalOrder(run: string): string {
  const decompositions = new Map<number, readonly number[]>();
  const movable = new Map<number, boolean>();
  const out: string[] = [];
  // Code points in their final order that are not text yet.
  let pending: number[] = [];
  // The movable marks since the last starter.
  let stretch: number[] = [];
  const endStretch = (): void => {
    if (stretch.length <= LONGEST_PLAIN_RUN) {
      // A short stretch is left as it is: the platform orders it at a bounded cost.
      for (const mark of stretch) pending.push(mark);
    } else {
      out.push(textOf(pending), sortedByClass(stretch));
      pending = [];
    }
    stretch = [];
  };
  let index = 0;
  while (index < run.length) {
    const mark = run.codePointAt(index) ?? 0;
    index += mark > 0xffff ? 2 : 1;
    let decomposition = decompositions.get(mark);
    if (decomposition === undefined) {
      decomposition = codePointsOf(String.fromCodePoint(mark).normalize("NFD"));
      decompositions.set(mark, decomposition);
    }
    for (const point of decomposition) {
      let moves = movable.get(point);
      if (moves === undefined) {
        moves = isNonStarter(String.fromCodePoint(point));
        movable.set(point, moves);
      }
      if (moves) {
        stretch.push(point);
        continue;
      }
      // A starter: nothing is ever moved across it, so the stretch before it ends here.
      endStretch();
      pending.push(point);
      if (pending.length >= CHUNK) {
        out.push(textOf(pending));
        pending = [];
      }
    }
  }
  endStretch();
  out.push(textOf(pending));
  return out.join("");
}

/**
 * The text in Unicode Normalization Form C: the value of `text.normalize("NFC")`, for every text,
 * in time that grows with the length of the text and not with its square.
 */
export function composedForm(text: string): string {
  if (text.length <= LONGEST_PLAIN_RUN) return text.normalize("NFC");
  // The text before each long run and that run in canonical order; empty while there is none.
  const parts: string[] = [];
  let copied = 0;
  let runStart = 0;
  let runEnd = 0;
  const closeRun = (): void => {
    if (runEnd - runStart <= LONGEST_PLAIN_RUN) return;
    parts.push(text.slice(copied, runStart), inCanonicalOrder(text.slice(runStart, runEnd)));
    copied = runEnd;
  };
  for (const piece of text.matchAll(MARK_PIECES)) {
    if (piece.index !== runEnd) {
      closeRun();
      runStart = piece.index;
    }
    runEnd = piece.index + piece[0].length;
  }
  closeRun();
  if (parts.length === 0) return text.normalize("NFC");
  parts.push(text.slice(copied));
  return parts.join("").normalize("NFC");
}
