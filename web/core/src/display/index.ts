// The display rules of docs/design.md 4.7 and its appendix 5.4, as pure functions: how one
// message text becomes the blocks and inline nodes that a screen draws. Nothing here is stored,
// and nothing here creates markup: a caller builds elements from the returned values.
//
//   renderBlocks     a message text -> code blocks and chunks of prose (4.7.1, 4.7.4)
//   parseInline      one paragraph  -> text, code, link and emphasis nodes (4.7.2)
//   summaryLine      a summary      -> its first line without Markdown markers
//   relativeParts    seconds ago    -> a value and a unit for Intl.RelativeTimeFormat

export {
  MAX_LINE_CHARS,
  MAX_PROSE_CHARS,
  type ProsePiece,
  type RenderBlock,
  renderBlocks,
  splitParagraphs,
} from "./blocks.ts";
export { type RelativeParts, relativeParts, summaryLine } from "./helpers.ts";
export { type InlineNode, inlineText, parseInline } from "./inline.ts";
