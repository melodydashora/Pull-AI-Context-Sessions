// ChatGPT data export, `conversations.json` (docs/import-rules.md 2.5.1 `parseChatGPTExport`,
// with the changes of W4). Reached only for a file whose extension is `json`.

import { readMappingKeyOrders } from "./json-key-order.ts";
import { normaliseText, trimFull } from "./text.ts";
import type { JsonObject, ParsedMessage, ParsedSession, Role } from "./types.ts";

/** True for a JSON object: not null, not an array. */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? value : null;
}

// Reads a member the object itself has. A name that only the prototype knows, such as
// "constructor", is not a member of the file.
function member(object: JsonObject, key: string): unknown {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

/** First and last millisecond that RFC 3339 can write: years 0000 to 9999. */
const EARLIEST_MS = -62_167_219_200_000;
const LATEST_MS = 253_402_300_799_999;

// W4: `create_time` counts only when it is a finite number; seconds since 1970, milliseconds kept.
// A number outside the years 0000 to 9999 has no RFC 3339 form (README "Result format") and
// counts as no date.
function timestampOf(value: unknown): string | null {
  if (typeof value !== "number") return null;
  const milliseconds = Math.floor(value * 1000);
  if (!Number.isFinite(milliseconds) || milliseconds < EARLIEST_MS || milliseconds > LATEST_MS) return null;
  return new Date(milliseconds).toISOString();
}

// W4: `message.create_time` when it is a number, else 0.
function messageTime(mappingNode: JsonObject): number {
  const message = member(mappingNode, "message");
  const time = isJsonObject(message) ? member(message, "create_time") : undefined;
  return typeof time === "number" ? time : 0;
}

// 2.5.1: the branch that ends at `current_node`, oldest node first. W4: a set of visited ids
// stops the walk at the first repeat (D9, fixture 10), so it ends after at most one step per id.
function branchEndingAt(mapping: JsonObject, currentNode: string): JsonObject[] {
  const nodes: JsonObject[] = [];
  const visited = new Set<string>();
  let cursor: unknown = currentNode;
  while (typeof cursor === "string" && !visited.has(cursor)) {
    const node = member(mapping, cursor);
    if (!isJsonObject(node)) break;
    visited.add(cursor);
    nodes.push(node);
    cursor = member(node, "parent");
  }
  return nodes.reverse();
}

function sameKeys(textOrder: readonly string[], own: readonly string[]): boolean {
  if (textOrder.length !== own.length) return false;
  const ownSet = new Set(own);
  return textOrder.every((key) => ownSet.has(key));
}

const DIGITS_ONLY = /^[0-9]+$/;

type KeysOfMapping = (mapping: JsonObject, conversation: number) => string[];

// W4: the keys of a conversation's `mapping` in the order of the JSON text. JSON.parse keeps
// that order unless a key looks like an array index; only then is the text read, once.
function keysInTextOrder(jsonText: string | undefined): KeysOfMapping {
  let orders: Map<number, string[]> | null = null;
  return (mapping, conversation) => {
    const own = Object.keys(mapping);
    if (jsonText === undefined || !own.some((key) => DIGITS_ONLY.test(key))) return own;
    orders ??= readMappingKeyOrders(jsonText);
    const textOrder = [...new Set(orders.get(conversation) ?? [])];
    // Used only when it names exactly the keys the parsed object has.
    return sameKeys(textOrder, own) ? textOrder : own;
  };
}

// W4 "time order": a stable sort by message.create_time, ties in the order of the keys in
// the JSON text (D9, fixture 11).
function nodesByTime(mapping: JsonObject, keys: readonly string[]): JsonObject[] {
  const entries: { readonly value: JsonObject; readonly time: number; readonly position: number }[] = [];
  for (const key of keys) {
    const value = member(mapping, key);
    if (isJsonObject(value)) entries.push({ value, time: messageTime(value), position: entries.length });
  }
  // Two infinite times differ by NaN, which counts as a tie.
  entries.sort((a, b) => a.time - b.time || a.position - b.position);
  return entries.map((entry) => entry.value);
}

const ROLES: ReadonlyMap<string, Role> = new Map<string, Role>([
  ["user", "user"],
  ["assistant", "assistant"],
  ["system", "system"],
]);

// 2.5.1: one node gives at most one message.
function messageOf(mappingNode: JsonObject): ParsedMessage | null {
  const message = member(mappingNode, "message");
  if (!isJsonObject(message)) return null;
  const author = member(message, "author");
  const content = member(message, "content");
  if (!isJsonObject(author) || !isJsonObject(content)) return null;
  const authorRole = member(author, "role");
  if (typeof authorRole !== "string") return null;
  // Only the string parts count; images and other content contribute nothing.
  const strings: string[] = [];
  for (const part of asArray(member(content, "parts")) ?? []) {
    if (typeof part === "string") strings.push(part);
  }
  // W4: W1 on the joined parts, then the full trim.
  const text = trimFull(normaliseText(strings.join("\n")));
  if (text === "") return null;
  // Any other author, a tool for example, is kept as role unknown; system messages are skipped.
  const role = ROLES.get(authorRole) ?? "unknown";
  return role === "system" ? null : { role, text };
}

function titleOf(conversation: JsonObject): string {
  const title = member(conversation, "title");
  // W4: trim, then the fallback. W1 applies to every string taken out of JSON.
  const cleaned = typeof title === "string" ? trimFull(normaliseText(title)) : "";
  return cleaned === "" ? "ChatGPT conversation" : cleaned;
}

/**
 * W4. `json` is the parsed file. null: not this format. An empty list: an export without
 * any message (the caller rejects it as `no_messages`). Sessions come in file order (C9).
 *
 * The top level is an array, in which every entry that is an object with a `mapping`
 * object is a conversation and everything else is skipped (D9, fixture 09), or one such object.
 *
 * `jsonText`, when given, is the text `json` was parsed from. It is read only to order nodes
 * whose ids look like array indices; without it those follow the order of JSON.parse.
 */
export function parseChatGPTExport(json: unknown, jsonText?: string): ParsedSession[] | null {
  const candidates = asArray(json) ?? (isJsonObject(json) ? [json] : null);
  if (candidates === null) return null;

  const keysOf = keysInTextOrder(jsonText);
  const sessions: ParsedSession[] = [];
  let recognised = false;
  for (let index = 0; index < candidates.length; index++) {
    const conversation = candidates[index];
    if (!isJsonObject(conversation)) continue;
    const mapping = member(conversation, "mapping");
    if (!isJsonObject(mapping)) continue;
    recognised = true;

    const currentNode = member(conversation, "current_node");
    let nodes = typeof currentNode === "string" ? branchEndingAt(mapping, currentNode) : [];
    // W4: if the walk from `current_node` collects nothing, use the time order.
    if (nodes.length === 0) nodes = nodesByTime(mapping, keysOf(mapping, index));

    const messages: ParsedMessage[] = [];
    for (const node of nodes) {
      const message = messageOf(node);
      if (message !== null) messages.push(message);
    }
    // W12: a conversation without a message gives no session.
    if (messages.length === 0) continue;
    sessions.push({
      title: titleOf(conversation),
      provider: "chatgpt",
      model: "",
      sourceUrl: "",
      createdAt: timestampOf(member(conversation, "create_time")),
      summary: "",
      tags: [],
      messages,
    });
  }
  return recognised ? sessions : null;
}
