# Claude API: what the Apple app does and what the web app should do

> **Status (2026-11-20).** Extracted from the Apple app's source, written for one owner and one server-side API key. The parts on what the Apple app does and on its defects are ready to build from. Where the web design here assumes a single owner or a single key, `../HANDOFF.md` section 2 wins, and section 5 there lists what is being revised.

## Summary

- The Apple app calls Anthropic directly from the device with hand-written HTTP: `POST https://api.anthropic.com/v1/messages`, streaming, `max_tokens` 64000, header `anthropic-version: 2023-06-01`, key read from the Keychain. There are exactly two call sites: "Continue with Claude" (a chat appended to the session) and "Summarize" (overwrites the session summary).
- Every request carries the whole stored transcript. There is no truncation, token counting, prompt caching, retry, timeout handling or cancel. Only `stop_reason: "refusal"` is handled, and only in the chat.
- Checked against Anthropic's documentation on 2026-11-19: the app's five model ids still work but all are superseded. Current ids are `claude-opus-5-5` (the documented default choice), `claude-fable-5-2`, `claude-sonnet-5-5` and `claude-haiku-5-5`. The beta header `server-side-fallback-2026-07-01` is still required for `fallbacks: "default"` and still valid. The current API version is `2026-10-21`.
- Web app: the browser never holds the key and never calls Anthropic. A Node server holds `ANTHROPIC_API_KEY`, uses `@anthropic-ai/sdk` 1.x, builds prompts from the stored session with a pure TypeScript module, and relays the reply to the browser as server-sent events on a POST response.
- The web app adds what the Apple app lacks: a server-side model registry, a pre-flight token count with a confirmation threshold, prompt caching, a rule for every stop reason, stable error codes, a Stop action, one turn at a time per session, rate and budget guards, and tests against a scripted fake upstream.
- Scale check: a 1,000,000-character session is roughly 400,000 tokens. It fits the 1,000,000-token context window of all four current models. On `claude-opus-5-5` it costs about 1.60 USD of input per uncached message and about 0.08 USD per message when read from the prompt cache.

## Conventions

- Part A is what the Apple app does today. Part B lists defects and accidents the web app must not copy. Part C is what the web app must do. The section between B and C records the check against current documentation.
- File references are relative to the repository root, for example `apple/SessionVault/ClaudeAPI.swift:56`. Below, `ClaudeAPI.swift`, `ContinueChatView.swift`, `SessionDetailView.swift`, `ContextPack.swift` and `Models.swift` are short for the files under `apple/SessionVault/` and `apple/SessionVault/Views/`.
- Strings quoted from the source that contain non-ASCII characters are written with JavaScript escapes: `\u2014` is an em dash, `\u2026` is an ellipsis. Everything else is literal.
- "(inference)" marks a statement that neither the code nor the documentation shows directly.
- "The docs" means the official Anthropic documentation on platform.claude.com and the `@anthropic-ai/sdk` repository at version 1.11.0, both read on 2026-11-19. Sources are listed at the end.
- No request was sent to the Anthropic API for this document, and the Apple app was not run. The prompt assembly in Part A was verified by compiling the relevant function bodies with `swiftc` and running them on synthetic data. The pure rules of Part C (C3 prompt assembly, the C5 turn rules as an in-memory model, C7 outcomes, the C8 mapping order, the C9 pre-flight and the browser stream parser) were written as plain JavaScript and run against the examples in this document. The SDK calls in C4 are a sketch that was not compiled.
- Names: routes and the `clientTurnId` field follow web-platform.md section 9; tables and columns follow data-model.md 7.2. The turn table, the stream events, the error codes and the environment variables are introduced here. Where this document and web-platform.md differ on the Claude flow, the difference is stated in C5 and this document governs (web-platform.md leaves the outcome rules and the turn representation to it).

## Part A: what the Apple app does today

### A1. Call sites

| Feature | Trigger | Code | Model | What is sent | Where the result goes |
|---|---|---|---|---|---|
| Continue with Claude | Toolbar button opens a sheet; the user sends a message in the composer | `ContinueChatView.swift:248-305` | Picker in the sheet, default `claude-opus-5` | The stored transcript as a list of user and assistant messages, ending with the new user message | New user and assistant `ChatMessage` rows; `session.modelName` |
| Summarize | Toolbar button "Summarize (keeps code intact)" | `SessionDetailView.swift:119-161` | Always `claude-opus-5` | One user message holding the flattened transcript | `session.summary`, overwritten |

Both use one client function, `ClaudeClient.stream(apiKey:model:system:messages:)` (`ClaudeAPI.swift:47-125`). Nothing else in the app calls Claude. `ContextPack.markdown(for:)` builds a text export for pasting into any model; it is never sent to the API (section A7).

### A2. The HTTP request

| Item | Value | Code |
|---|---|---|
| URL | `https://api.anthropic.com/v1/messages` | `ClaudeAPI.swift:56` |
| Method | `POST` | `:57` |
| Header | `Content-Type: application/json` | `:58` |
| Header | `x-api-key: <key from the Keychain>` | `:59` |
| Header | `anthropic-version: 2023-06-01` | `:60` |
| Header, three models only | `anthropic-beta: server-side-fallback-2026-07-01` | `:72-73` |
| Body `model` | model id string | `:63` |
| Body `max_tokens` | `64000` for both features | `:64` |
| Body `stream` | `true` | `:65` |
| Body `system` | one string (section A4) | `:66` |
| Body `messages` | array of `{"role": "user" or "assistant", "content": "<string>"}` | `:67` |
| Body `fallbacks`, three models only | the string `"default"` | `:74` |

Not sent: `thinking`, `output_config` (effort), `temperature`, `top_p`, `top_k`, `tools`, `cache_control`, `metadata`, `stop_sequences`. The body is serialised from a dictionary, so key order is unspecified (`:76`). The transport is `URLSession.shared.bytes(for:)` with no custom configuration (`:78`).

### A3. Model list, default and fallback list

| Id | Name shown | In the fallback list |
|---|---|---|
| `claude-opus-5` (default, `ClaudeAPI.swift:16`) | Claude Opus 5 | yes |
| `claude-fable-5-1` | Claude Fable 5.1 | yes |
| `claude-fable-5` | Claude Fable 5 | yes |
| `claude-sonnet-5` | Claude Sonnet 5 | no |
| `claude-haiku-4-5` | Claude Haiku 4.5 | no |

The list is a constant in client code (`ClaudeAPI.swift:8-14`); the fallback list is a second constant (`:24-26`). The picker order is the order above. The chosen model is view state: it resets to the default each time the sheet opens and is not stored (`ContinueChatView.swift:14`). `apple/README.md:16` names only four models and is out of date.

### A4. System prompts, verbatim

Both are single-line strings without a trailing newline (the Swift literals use `\` line continuations). Lengths were confirmed by running the literals: 258 and 364 characters.

```ts
// ContinueChatView.swift:274-278
export const CONTINUE_SYSTEM_PROMPT_V1 =
  "You are continuing an important conversation from the user's session vault. " +
  "The conversation history may come from an earlier session with another AI assistant. " +
  "Treat its facts and decisions as established context and continue helping from where it left off.";

// SessionDetailView.swift:134-140
export const SUMMARIZE_SYSTEM_PROMPT_V1 =
  "You summarize saved AI conversation transcripts for the user's session vault. " +
  "Produce a concise summary of the conversation's goals, decisions, and outcomes. " +
  "Preserve every code block, command, file path, and identifier exactly as written \u2014 " +
  "complete and verbatim, in fenced code blocks. Never truncate, paraphrase, or omit code. " +
  "Compress the prose, never the code.";
```

### A5. How a "Continue" request is assembled

`ContinueChatView.swift:248-305`. `orderedMessages` is the session's messages sorted by `index` ascending (`Models.swift:92-94`).

1. `text` = composer input trimmed of white space and newlines. Stop if `text` is empty, a request is already streaming, or there is no key (`:249-250`).
2. Clear the composer and the error banner (`:251-252`).
3. `nextIndex` = (largest existing `index`, or -1 when there are no messages) + 1 (`:254`).
4. Insert a user message `{index: nextIndex, role: user, text}` into the vault now, before any network call (`:255-257`).
5. Build `apiMessages` from `orderedMessages`, which now includes the new message (inference: the code relies on SwiftData updating the relationship at once):
   - skip a message only when its text is the empty string (`:260`);
   - role is `"assistant"` when the stored role is `assistant`, otherwise `"user"`. Stored roles `system` and `unknown` (shown as "Note") are sent as `"user"` with no label (`:262`);
   - content is the stored text, unchanged (`:263`).
6. If the first element's role is not `"user"`, insert `{"role": "user", "content": "(Earlier transcript follows.)"}` at position 0 (`:266-268`).
7. Call the client with the picked model, `CONTINUE_SYSTEM_PROMPT_V1` and `apiMessages` (`:280-282`).

Nothing is truncated, summarised or counted. Consecutive messages with the same role are sent as they are. The session title, dates, tags and summary are not sent.

### A6. How a "Summarize" request is assembled

`SessionDetailView.swift:119-161`.

1. Read the key from the Keychain. If there is none, show an alert and stop (`:120-123`).
2. `transcript` = for each message in `orderedMessages`: `<label>` + `":\n"` + `<text>`, joined with `"\n\n---\n\n"` (`:124-126`). Labels: `user` -> `User`, `assistant` -> `Assistant`, `system` -> `System`, `unknown` -> `Note` (`Models.swift:28-35`). Messages with empty text are included, as a label followed by nothing.
3. If `transcript` is empty (only possible when the session has no messages), show an alert and stop (`:127-130`).
4. Call the client with model `claude-opus-5` (always), `SUMMARIZE_SYSTEM_PROMPT_V1`, and `messages = [{"role": "user", "content": transcript}]` (`:141-147`).
5. Concatenate all streamed text. The stop reason is ignored (`:148`).
6. Trim. If the result is empty, show an alert. Otherwise assign it to `session.summary`, replacing whatever was there, including text the user typed (`:150-155`).

### A7. The context pack (export text, not an API call)

`ContextPack.swift:7-43` returns lines joined with `"\n"`:

1. `# Context pack: <title>`, then an empty line.
2. `Origin: <provider display name>`; if the model label is not empty, ` (<model label>)`; then `, saved <original date>`. The date uses the device locale and time zone, date only, abbreviated style; on a US English device it reads `Aug 5, 2026`.
3. If the source link is not empty: `Source: <link>`.
4. If there are tags: `Tags: <tags joined with ", ">`.
5. An empty line.
6. If the summary is not empty: `## Summary`, empty line, the summary, empty line.
7. Three fixed lines, then an empty line:
   ```
   You are being given the transcript of an earlier conversation the user had
   with another AI assistant. Read it, treat its decisions and facts as established
   context, and continue helping from where it left off.
   ```
8. `## Transcript`, then an empty line.
9. For each message in order: `**<label>:**`, empty line, the text, empty line, `---`, empty line.

So the app has three different transcript renderings: API messages (A5), the summarize transcript (A6) and the context pack. data-model.md (4.1, 8.3, 9.3) owns the context pack for the web app; this section is here because the pack is the app's third piece of prompt building. Golden output, produced by running the function on synthetic data (US English device):

```text
# Context pack: EXAMPLE herb bed plan

Origin: ChatGPT (example-model-1), saved Aug 5, 2026
Source: https://example.invalid/share/EXAMPLE-0001
Tags: garden, example

## Summary

Plan a shaded herb bed.

You are being given the transcript of an earlier conversation the user had
with another AI assistant. Read it, treat its decisions and facts as established
context, and continue helping from where it left off.

## Transcript

**User:**

Which herbs tolerate shade?

---

**Assistant:**

Mint, parsley and chives.

---
```

The string ends with `---` followed by exactly one `"\n"` (521 characters in total for this example). With no messages it ends with `## Transcript` followed by one `"\n"`.

### A8. Streaming: which events are handled

`ClaudeAPI.swift:79-118`.

1. If the HTTP status is not 200: read the whole body, parse it as JSON, and fail with `error.message`; if that is missing, fail with `HTTP <status>` (`:79-84`, `:127-132`).
2. Otherwise read the body line by line. Lines that do not start with `data: ` (with the space) are ignored, so SSE `event:` names are never read (`:88`).
3. Parse the rest of the line as JSON and switch on its `type` field (`:90-94`):

| `type` | Handling |
|---|---|
| `content_block_delta` with `delta.type == "text_delta"` | emit `delta.text` (`:95-100`) |
| `message_delta` | if `delta.stop_reason` is a string, remember it; the last one wins (`:101-105`) |
| `message_stop` | emit "done" with the remembered stop reason and finish (`:106-109`) |
| `error` | fail with `error.message`, or `Stream error` when absent (`:110-112`) |
| anything else (`message_start`, `content_block_start`, `content_block_stop`, `ping`, thinking and signature deltas, fallback blocks) | ignored (`:113-114`) |

4. If the body ends without `message_stop`, emit "done" with whatever stop reason was seen (possibly none) and finish normally (`:117-118`).

Text from all text blocks is concatenated without separators. The response's `model`, `usage`, `stop_details` and content block boundaries are never read.

### A9. Stop reasons, refusals, and what gets saved

Continue (`ContinueChatView.swift:279-303`); `reply` is the concatenated text trimmed of white space and newlines:

| Case | Result |
|---|---|
| Stop reason is `"refusal"` | Banner "Claude declined this request (safety classifiers)." Partial text is discarded. No assistant message is saved (`:291-292`). |
| Any other stop reason (including none, `max_tokens`) and `reply` not empty | Assistant message saved with `index = nextIndex + 1`; `session.modelName` set to the picked model id (`:293-298`). |
| `reply` empty and not a refusal | Nothing saved, nothing shown. |
| The stream failed | Banner with the error text; partial text discarded (`:299-303`). |

In every case the user message inserted in A5 step 4 stays in the vault.

Server-side fallbacks: for the three listed models the request opts in with the beta header and `fallbacks: "default"`. The app does not read which model answered. Because unknown event types are ignored and text is concatenated, text from a declined attempt and from the fallback model ends up in one reply (inference from the code and the documented stream shape; not observed). A final `refusal` means the banner above.

Summarize ignores the stop reason completely (A6 steps 5 and 6).

### A10. Errors and messages shown to the user

| Situation | Text | Where shown | Code |
|---|---|---|---|
| HTTP status other than 200 | Anthropic's `error.message`, unchanged; else `HTTP <status>` | Chat: red banner with a dismiss button. Summarize: alert titled "Summarize" with an "OK" button | `ClaudeAPI.swift:79-84` |
| `error` event inside the stream | Its `error.message`; else `Stream error` | same | `ClaudeAPI.swift:110-112` |
| Network failure | The operating system's localized description | same | `ContinueChatView.swift:300`, `SessionDetailView.swift:157` |
| Refusal in chat | `Claude declined this request (safety classifiers).` | banner | `ContinueChatView.swift:292` |
| Summarize without a key | `Add your Anthropic API key first \u2014 open Continue with Claude to set it up.` | alert | `SessionDetailView.swift:121` |
| Summarize with no messages | `This session has no messages to summarize.` | alert | `SessionDetailView.swift:128` |
| Summarize returned no text | `Claude returned no summary \u2014 it may have declined the request.` | alert | `SessionDetailView.swift:152` |

There is no mapping by status code or error type, and no retry. The banner is cleared when the next message is sent (`ContinueChatView.swift:252`).

Other strings of this feature, for design.md: sheet title `Continue with Claude`; button `Close`; picker label `Model`; composer placeholder `Continue the conversation\u2026`; waiting indicator `Claude is thinking\u2026` (shown from send until the first text arrives, `ContinueChatView.swift:117-123`); the in-flight reply is labelled `Claude` and shown as plain text, then replaced by the stored message, which is labelled `Assistant` and rendered with code blocks; a small line above the composer shows the display name of the picked model (`ContinueChatView.swift:206-212`).

### A11. API key storage and validation

- Storage: one Keychain generic-password item; service is the app's bundle identifier (`ClaudeAPI.swift:137`), account is `anthropic-api-key` (`:138`). No accessibility class, access group or synchronisation attribute is set (`:140-146`), so the key is not copied to the owner's other devices (inference from the Keychain defaults).
- Save: delete the existing item, then add the new one; the result of the add is ignored; an empty key only deletes (`:148-154`).
- Load: returns the stored string, or nothing when it is missing or empty (`:156-165`). The chat reads it once when the sheet is created (`ContinueChatView.swift:12`); Summarize reads it on each click (`SessionDetailView.swift:120`).
- Delete: `deleteAPIKey()` exists (`:167-169`) and is never called.
- Entry screen, shown inside the Continue sheet only while no key is stored (`ContinueChatView.swift:31-35`, `:64-98`): title `Connect to Claude`; text `Add your Anthropic API key to continue this session live. The key is stored in your Keychain and sent only to api.anthropic.com.`; secure field with placeholder `sk-ant-\u2026`; button `Save Key`, disabled while the field is blank; footnote `Create a key at console.anthropic.com.`
- Validation: none. `saveKey()` trims spaces and requires a non-empty string (`:100-105`). A wrong key is discovered on the first request, as Anthropic's error text in the banner. After that there is no screen to replace or remove the key.

### A12. Cancel, timeouts, retries, concurrency

- The client cancels its network task when the consumer stops listening (`ClaudeAPI.swift:123`), but nothing in the user interface ever does that. There is no Stop button: while streaming, the send button is replaced by a spinner and the field is disabled (`ContinueChatView.swift:218-237`).
- Closing the sheet does not cancel. The request runs to the end in an unstructured task and the reply is still saved to the vault (inference from `:272-304`; the task holds the session and the model context).
- Summarize has no cancel either. Leaving the session while it runs discards the spinner and any error alert (the detail view is recreated per session, `apple/SessionVault/Views/RootView.swift:62-63`), but the summary is still overwritten when the request finishes (inference).
- No timeout is configured. The system default applies: a request fails after 60 seconds without receiving data (inference from the platform default, not visible in the code).
- No retries of any kind.
- Double sends are prevented only by view state (`isStreaming`, `isSummarizing`).

### A13. Golden example for A5 and A6

Synthetic input. Stored messages as `(index, role, text)`:

````json
[
  [0, "assistant", "Welcome back. Last time we planned the herb bed."],
  [1, "user", "Which herbs tolerate shade?"],
  [2, "unknown", "EXAMPLE note captured from the page"],
  [3, "assistant", "Mint, parsley and chives.\n\n```sh\necho EXAMPLE\n```"],
  [4, "system", "EXAMPLE system text"],
  [5, "assistant", ""],
  [7, "user", "   "]
]
````

Composer input: `"  How often should I water mint?\n"`.

Apple output for Continue (new user message gets index 8):

````json
[
  {"role": "user", "content": "(Earlier transcript follows.)"},
  {"role": "assistant", "content": "Welcome back. Last time we planned the herb bed."},
  {"role": "user", "content": "Which herbs tolerate shade?"},
  {"role": "user", "content": "EXAMPLE note captured from the page"},
  {"role": "assistant", "content": "Mint, parsley and chives.\n\n```sh\necho EXAMPLE\n```"},
  {"role": "user", "content": "EXAMPLE system text"},
  {"role": "user", "content": "   "},
  {"role": "user", "content": "How often should I water mint?"}
]
````

Apple output for Summarize, before the new message is added (the single user message's content):

````json
"Assistant:\nWelcome back. Last time we planned the herb bed.\n\n---\n\nUser:\nWhich herbs tolerate shade?\n\n---\n\nNote:\nEXAMPLE note captured from the page\n\n---\n\nAssistant:\nMint, parsley and chives.\n\n```sh\necho EXAMPLE\n```\n\n---\n\nSystem:\nEXAMPLE system text\n\n---\n\nAssistant:\n\n\n---\n\nUser:\n   "
````

The web app's expected output differs in one deliberate way (defect B4): the blank messages at index 5 and 7 are left out. For Continue that removes the `"   "` element. For Summarize the string ends after `System:\nEXAMPLE system text`.

## Part B: defects and accidents the web app must not copy

| Id | What the Apple app does | Evidence | Web app behaviour |
|---|---|---|---|
| B1 | Saves a reply cut off by `max_tokens` as if it were complete; any stop reason other than `refusal` is ignored | `ContinueChatView.swift:291-298` | Branch on every stop reason (C7). Mark truncated replies. |
| B2 | Treats a stream that ends without `message_stop` as a normal finish, so a dropped connection can save half a reply | `ClaudeAPI.swift:117-118` | Only a final message with a stop reason counts as finished. Anything else is the error `stream_interrupted`. |
| B3 | Summarize overwrites the summary without asking and ignores refusals and truncation; a refused or truncated result replaces a hand-written summary | `SessionDetailView.swift:148-155` | Ask before replacing a non-empty summary; save only a complete result; return a truncated result as a draft. |
| B4 | Sends white-space-only messages (only the empty string is skipped); Summarize includes blank messages as a bare label | `ContinueChatView.swift:260`, `SessionDetailView.swift:124-126` | Skip every message whose text is blank after trimming. The API rejects text blocks without non-white-space text (from prior knowledge of the API; not in the pages read). |
| B5 | Inserts the user message before the call and leaves it in the vault when the call fails or is refused; later requests resend it; the app cannot delete a single message | `ContinueChatView.swift:255-257`, `:299-303` | Keep the pending text in the turn row and commit the user message together with the reply. On failure or refusal no message is added and the text goes back to the composer (C5). |
| B6 | An empty, non-refused reply produces no message and no feedback | `ContinueChatView.swift:290-298` | Report outcome `empty` with the stop reason. |
| B7 | No Stop action; closing the sheet does not cancel | `ContinueChatView.swift:218-237`, `:272-304` | An explicit stop route. A lost connection is not a stop. |
| B8 | Sends the whole transcript with no size check, no confirmation and no caching; a transcript larger than the model's window fails with a raw API message | `ContinueChatView.swift:259-265`, `ClaudeAPI.swift:62-68` | Pre-flight token count, hard limit, confirmation threshold, prompt caching (C9, C10). |
| B9 | Model ids are compiled into the client and are a generation behind; `claude-haiku-4-5` has a 200,000-token window and is past its earliest retirement date | `ClaudeAPI.swift:8-16` | Server-side registry served to the client (C2). |
| B10 | Sets the session's model label to the model that was requested, overwriting the origin label of an imported session, and not the model that answered after a fallback | `ContinueChatView.swift:297` | Record the answering model on the assistant message. Set the session label only when it is empty and the session's provider is `claude` (C5). |
| B11 | No way to replace or remove a saved key; the Keychain write result is ignored; no validation | `ClaudeAPI.swift:148-154`, `:167-169`, `ContinueChatView.swift:31-35` | The key is a server secret. The settings screen shows whether it is configured and working, never the key. |
| B12 | Shows raw upstream error text; no distinction between a bad key, a rate limit, an overload and a too-long prompt; no retry guidance | `ClaudeAPI.swift:79-84`, `ContinueChatView.swift:300` | Stable error codes with fixed messages, upstream text as detail (C8). |
| B13 | The refusal text always says "safety classifiers" and drops the category and explanation the API returns | `ContinueChatView.swift:292` | Show the explanation and category from `stop_details` when present. |
| B14 | No timeout handling. The platform's 60-second idle default applies, and a slow first byte on a very large prompt could exceed it (both inference) | `ClaudeAPI.swift:78` | Server deadline, heartbeat to the browser, explicit timeout error. |
| B15 | Raw HTTP with the old API version header and the legacy `x-api-key` header | `ClaudeAPI.swift:59-60` | Official SDK; it sets the version and authentication headers. |
| B16 | The fallback opt-in is a hard-coded id list | `ClaudeAPI.swift:24-30` | A per-model flag in the server registry. |
| B17 | The summary field doubles as a hand-written note (one line in the list, searched) and as a long generated summary with verbatim code | `SessionDetailView.swift:154`, `:196` | Keep one field unless the owner chooses to split it; render it as Markdown in an expandable area (design.md). |
| B18 | Stored `system` and `unknown` messages are sent as unlabeled user turns | `ContinueChatView.swift:262` | Keep the mapping to `user`. Do not "improve" it by sending stored `system` text as an API system message: captured transcripts are untrusted and would gain operator authority. |
| B19 | The context pack date depends on the device locale and time zone | `ContextPack.swift:13` | Fixed `en-US` date form and an explicit time zone (data-model.md 8.3). |

## Check against current documentation (2026-11-19)

| Topic | Apple app | Current documentation | Action for the web app |
|---|---|---|---|
| Model ids | `claude-opus-5` (default), `claude-fable-5-1`, `claude-fable-5`, `claude-sonnet-5`, `claude-haiku-4-5` | All five are still listed as active. Latest models: `claude-fable-5-2`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, each with a 1M-token context window and 128K max output. "If you're unsure which model to use, start with Claude Opus 5.5". Ids are complete as written: no date suffix. `claude-haiku-4-5` has a 200K window and its earliest retirement date (2026-10-15) has passed. | Default `claude-opus-5-5`. Offer the four latest ids. Keep the list in server configuration. |
| API version | `2023-06-01` | `2026-10-21` is current; `2023-06-01` is still in the version history. The new version rejects `temperature`, `top_p`, `top_k` on every model. `@anthropic-ai/sdk` 1.0.0 is the first release that sends `2026-10-21`. | Let the SDK set it. Never send sampling parameters. |
| Authentication header | `x-api-key` | `Authorization: Bearer <key>` is primary; `x-api-key` is described as "Legacy fallback for `Authorization`, still supported". SDK 1.x sends the bearer form. | Nothing to do when using the SDK. Test stubs must read `Authorization`. |
| Fallback beta header | `server-side-fallback-2026-07-01` | Still required and valid. It must carry exactly `2026-07-01` (supports `"default"` and the list form) or `2026-06-01` (list form only); any other `server-side-fallback-*` value makes `fallbacks` a 400. Server-side fallback is in beta on the Claude API. | Keep it, as configuration. |
| Which models take `fallbacks` | A fixed list of three | Classifier refusals exist on Fable 5.2, 5.1, 5, Opus 5.5, Opus 5, Sonnet 5.5 and Haiku 5.5. `"default"` retries on the model Anthropic recommends for the refusal category; for categories with no recommended fallback (`reasoning_extraction`, for example) the refusal stands, and the per-model routing is not published; Haiku 5.5 has no server-side fallback. "On a model that doesn't support fallbacks, the request runs on the requested model alone", so `"default"` does not cause a 400; a model list does. | Per-model flag: on for Opus 5.5, Fable 5.2, Sonnet 5.5; off for Haiku 5.5. |
| Stop reasons | Only `refusal` | `end_turn`, `max_tokens`, `stop_sequence`, `tool_use`, `pause_turn`, `refusal`, `model_context_window_exceeded`. The SDK's beta types add `compaction`. New values can appear. "A refusal can arrive before any output, or mid-stream after partial output. In either case, treat any partial output as incomplete and discard it." Branch on `stop_reason`, not on `stop_details`, whose fields can be null. | Table in C7. |
| Refusal details | Not read | `stop_details` = `{type: "refusal", category, explanation, recommended_model}`; categories `cyber`, `bio`, `frontier_llm`, `reasoning_extraction`, `general_harms` or null. The explanation text "is not stable, so display it rather than parse it". Some refusals are billed (`bio`, `frontier_llm`, `reasoning_extraction`). | Show it. Never retry the same model automatically. |
| Streaming events | Reads `data:` lines; handles 4 types | Event flow: `message_start`, then per block `content_block_start` / `content_block_delta` / `content_block_stop`, then `message_delta`, then `message_stop`; `ping` at any time; `error` events can arrive after a 200. With a mid-output fallback the open block closes and a `fallback` block (start and stop, no deltas) marks the boundary, after which the fallback model continues from the partial text. Unknown event types must be tolerated. | Use the SDK stream helper. Do not parse SSE from Anthropic by hand. |
| Thinking | Not configured | On all four current models thinking is on when `thinking` is omitted. `{"type": "disabled"}` is a 400 on Opus 5.5, Fable 5.2 and Sonnet 5.5. Thinking text is omitted by default, is billed as output, and counts toward `max_tokens`. | Omit `thinking`. Keep `max_tokens` generous. Show the waiting indicator until the first text. |
| Effort | Not sent | `output_config.effort` defaults: `medium` on Opus 5.5 and Haiku 5.5, `high` on Fable 5.2 and Sonnet 5.5. Changing it between requests invalidates the message cache. | Do not send it unless the registry sets it; keep it constant. |
| `max_tokens` | 64000 | Hard cap on thinking plus text. Up to 128K on the current models. If input plus `max_tokens` exceeds the window the request is accepted and may stop with `model_context_window_exceeded`. | Keep 64000 as the default, configurable. |
| Context limits | No check | Input alone above the window: 400 `invalid_request_error` ("prompt is too long"). 1M tokens "is roughly 555k words or 2.5M Unicode characters on the current tokenizer". Limit of 100,000 messages per request. Request size limit 128 MB. | Pre-flight count (C9). |
| Token counting | None | `POST /v1/messages/count_tokens` takes the same `model`, `system`, `messages`; free; its own rate limit (5,000 requests per minute on the Start tier); the result is an estimate; counts are model-specific. | Count before large requests with the model that will be used. |
| Prompt caching | None | Top-level `cache_control: {"type": "ephemeral"}` places a breakpoint on the last block and moves it as the conversation grows. TTL 5 minutes by default or `"ttl": "1h"`. Writes cost 1.25x (5 min) or 2x (1 h) the input price; reads cost 0.05x on Opus 5.5 and Sonnet 5.5, 0.025x on Fable 5.2, 0.1x on Haiku 5.5. Minimum cacheable prefix 512 tokens on the four current models. The cache is per model and per workspace. The 1-hour TTL is recommended "when storing a long chat conversation with a user and you generally expect that user might not respond in the next 5 minutes". | Rules in C10. |
| Rate limits | Not handled | Per model: requests, input tokens and output tokens per minute. Start tier: 2,000,000 input tokens per minute for Opus 5.5, Sonnet 5.5 and Haiku 5.5; 500,000 for Fable 5.2. Cache reads do not count. New organisations may start below these limits. A sudden jump in usage can return 429 with `error.details.error_code` `ramp_limit_exceeded`. Reaching the tier's monthly spend cap returns 429 with `enforced_spend_limit_reached` and no `retry-after`. A spend limit the account owner set returns 400. | Surface the code and `retry-after` (C8). |
| Errors | Raw text | 400 `invalid_request_error`, 401 `authentication_error`, 402 `billing_error`, 403 `permission_error`, 404 `not_found_error`, 413 `request_too_large`, 429 `rate_limit_error`, 500 `api_error`, 504 `timeout_error`, 529 `overloaded_error`. After a stream has started, errors arrive as `error` events with no HTTP status. | Map by status, type and error code (C8). |
| Calling from a browser | Not applicable | "Call the Claude API from your own back end, not from code that runs in your users' browsers." Direct browser calls need the SDK option `dangerouslyAllowBrowser` and are refused for some organisations with a 401 that begins `CORS requests are not allowed for this Organization`. | Server only. |
| Where keys are made | `console.anthropic.com` | The Claude Console at `platform.claude.com/settings/keys`. Keys can have an expiry; an expired key returns 401. | Mention the new address in setup notes. |

Cost of one message on a 400,000-token transcript (input only, list prices in USD read on 2026-11-19; output is extra):

| Model | No caching | First message, 5-minute cache | First message, 1-hour cache | Later message read from cache |
|---|---|---|---|---|
| `claude-opus-5-5` (4 per million input tokens) | 1.60 | 2.00 | 3.20 | 0.08 |
| `claude-fable-5-2` (8) | 3.20 | 4.00 | 6.40 | 0.08 |
| `claude-sonnet-5-5` (2) | 0.80 | 1.00 | 1.60 | 0.04 |
| `claude-haiku-5-5` (0.50 above 100,000 prompt tokens) | 0.20 | 0.25 | 0.40 | 0.02 |

Example: five messages ten minutes apart on `claude-opus-5-5` cost 8.00 without caching, 10.00 with the 5-minute cache (every message misses and pays the write premium) and 3.52 with the 1-hour cache. A single message costs 1.60, 2.00 and 3.20 respectively.

## Part C: what the web app must do

### C1. Principles

1. The Anthropic key exists only on the server. No endpoint returns it; no log line contains it. In a Vite project, never give it a `VITE_` prefix: such variables are compiled into the browser bundle.
2. The browser sends only a session id, the new text, a model id and flags. The server loads the transcript from Postgres and builds the prompt. The client therefore cannot inject history, and request bodies stay small.
3. Prompt assembly is a pure TypeScript module in the shared package (no DOM, no Node), tested against the golden data in A13.
4. One server function performs every upstream call, so limits, caching, fallbacks and error mapping exist once.
5. A chat turn is written to the session only when there is a reply worth keeping (C5, C7).
6. Model ids, limits and beta names are server configuration. The client renders what `GET /api/claude/config` returns.
7. Use the owner's own Anthropic API key. Do not swap in the hosting platform's managed AI integration or an OpenAI-compatible layer: this contract needs the Anthropic Messages API with the `fallbacks` beta, top-level `cache_control`, `count_tokens` and the current model ids. The hosting platform's managed integration lists only older Claude ids (web-platform.md 10.10).

### C2. Server configuration

Environment variables (names are proposals; defaults in the last column):

| Variable | Meaning | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Secret. Without it, Claude features are off and every Claude route answers `not_configured`. Create the SDK client only when it is set, and pass it explicitly. | none |
| `CLAUDE_DEFAULT_MODEL` | Default for chat | `claude-opus-5-5` |
| `CLAUDE_SUMMARIZE_MODEL` | Model for Summarize | same as the default model |
| `CLAUDE_MODELS_JSON` | Optional replacement for the built-in registry below | unset |
| `CLAUDE_MAX_OUTPUT_TOKENS` | `max_tokens`, clamped to the model's maximum | `64000` |
| `CLAUDE_CACHE_TTL` | `1h`, `5m` or `off`, for chat requests | `1h` |
| `CLAUDE_SERVER_SIDE_FALLBACKS` | `on` or `off`, a global switch over the per-model flag | `on` |
| `CLAUDE_FALLBACK_BETA` | Beta header value | `server-side-fallback-2026-07-01` |
| `CLAUDE_CONFIRM_ABOVE_INPUT_TOKENS` | Ask the user before sending more than this | `100000` |
| `CLAUDE_MAX_INPUT_TOKENS` | Optional hard cap below the model window | unset |
| `CLAUDE_MAX_USER_TEXT_CHARS` | Longest new message | `200000` |
| `CLAUDE_REQUEST_DEADLINE_MS` | Wall-clock limit for one turn | `1200000` (20 minutes) |
| `CLAUDE_MAX_CONCURRENT_TURNS` | Turns in flight for the owner, across sessions | `2` |
| `CLAUDE_MAX_TURNS_PER_10_MIN` | App rate limit | `30` |
| `CLAUDE_MAX_TURNS_PER_DAY` | App daily limit (UTC day) | `300` |

The numeric defaults are recommendations of this document (inference), not values from the Apple app, which has none.

Model registry. Built-in default, as of 2026-11-19:

```ts
export interface ClaudeModelConfig {
  id: string;                 // exact API id; never add a date suffix
  name: string;               // shown in the picker
  contextWindow: number;      // input tokens; used when the Models API is unavailable
  maxOutputTokens: number;    // upper bound for max_tokens
  serverSideFallbacks: boolean;
  effort?: "low" | "medium" | "high" | "xhigh" | "max"; // omit = model default
  // Optional, only for cost estimates shown to the user. USD per million tokens.
  pricing?: { input: number; output: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number;
              above?: { promptTokens: number; input: number; output: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number } };
}

export const DEFAULT_CLAUDE_MODELS: ClaudeModelConfig[] = [
  { id: "claude-opus-5-5",   name: "Claude Opus 5.5",   contextWindow: 1_000_000, maxOutputTokens: 128_000, serverSideFallbacks: true,
    pricing: { input: 4, output: 20, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.20 } },
  { id: "claude-fable-5-2",  name: "Claude Fable 5.2",  contextWindow: 1_000_000, maxOutputTokens: 128_000, serverSideFallbacks: true,
    pricing: { input: 8, output: 40, cacheWrite5m: 10, cacheWrite1h: 16, cacheRead: 0.20 } },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", contextWindow: 1_000_000, maxOutputTokens: 128_000, serverSideFallbacks: true,
    pricing: { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.10 } },
  { id: "claude-haiku-5-5",  name: "Claude Haiku 5.5",  contextWindow: 1_000_000, maxOutputTokens: 128_000, serverSideFallbacks: false,
    pricing: { input: 0.10, output: 0.50, cacheWrite5m: 0.125, cacheWrite1h: 0.20, cacheRead: 0.01,
               above: { promptTokens: 100_000, input: 0.50, output: 2.50, cacheWrite5m: 0.625, cacheWrite1h: 1, cacheRead: 0.05 } } },
];
```

Rules:

- The client never contains a model id. It may remember the last picked id in local storage and must fall back to `defaultModel` when that id is no longer offered.
- Optional refresh (recommended): at start and at most once an hour, call the Models API (`client.models.list()`). Drop registry entries the key cannot see or whose `lifecycle` is `retired`; take `max_input_tokens` and `max_tokens` from the response when present. If the call fails for a reason other than authentication, use the static values.
- Key validation replaces the Apple key screen: the same Models API call sets `keyStatus` to `ok`, to `rejected` on a 401, or leaves it `unknown` when the call could not be made. Any later 401 from Anthropic also sets `rejected`. The settings screen shows this status and never the key.
- Prices are for estimates only and go stale. Show them as approximate.

### C3. Prompt assembly module (pure TypeScript)

Input is each stored message's flattened text as defined in data-model.md 6.3 (`messages.text`, the Apple `text` field), read in `position` order.

```ts
export type StoredRole = "user" | "assistant" | "system" | "unknown" | (string & {});
export interface PromptMessage { index: number; role: StoredRole; text: string }
export interface ApiTextMessage { role: "user" | "assistant"; content: [{ type: "text"; text: string }] }

export const EARLIER_TRANSCRIPT_PLACEHOLDER = "(Earlier transcript follows.)";

export function roleLabel(role: StoredRole): "User" | "Assistant" | "System" | "Note";
export function buildContinueMessages(stored: PromptMessage[], newUserText: string): ApiTextMessage[];
export function buildSummarizeTranscript(stored: PromptMessage[]): string;
```

`buildContinueMessages`:

1. Sort `stored` by `index` ascending; break ties by original array position. The order must be the same on every call.
2. Drop every message whose `text.trim()` is empty (B4).
3. Map each remaining message to `{role: stored role is "assistant" ? "assistant" : "user", content: [{type: "text", text}]}`. The text is passed through byte for byte: no trimming, no line-ending changes, no labels. Any role other than `assistant`, including unknown future roles, maps to `user`.
4. Append `{role: "user", content: [{type: "text", text: newUserText.trim()}]}`. The caller guarantees the trimmed text is not empty.
5. If the first element's role is not `user`, insert the placeholder as a user message at position 0.
6. Do not merge neighbours with the same role. The API combines consecutive turns of one role.

Always use the one-block array form for `content`, never the string shorthand, so that the only thing that can differ between two requests for the same message is a `cache_control` marker (inference: the documentation calls the string a shorthand for one text block but does not say that the two forms cache identically).

`buildSummarizeTranscript`: sort as above; drop blank messages; return `roleLabel(role) + ":\n" + text` for each, joined with `"\n\n---\n\n"`. Roles other than the four known ones use the label `Note`. An empty result means there is nothing to summarize.

The context pack is not part of this module's contract: its web function, `contextPackMarkdown`, and its test vectors are in data-model.md 8.3 and 9.3. That function matches A7, with the date fixed to the `en-US` form (`Aug 5, 2026`) and an explicit time zone.

Trim means JavaScript `String.prototype.trim()`. It differs from the Swift character set only for U+0085 and U+FEFF at the ends of a string (inference from the two definitions).

### C4. The upstream request

| Field | Web app value |
|---|---|
| `model` | An id from the registry; reject anything else with `validation` |
| `max_tokens` | `min(CLAUDE_MAX_OUTPUT_TOKENS, model.maxOutputTokens)` |
| `system` | `CONTINUE_SYSTEM_PROMPT_V1` or `SUMMARIZE_SYSTEM_PROMPT_V1`, exactly as in A4. No date, title or other variable text. |
| `messages` | Chat: `buildContinueMessages(...)`. Summarize: one user message whose single text block is `buildSummarizeTranscript(...)`. |
| `cache_control` | Chat: `{type: "ephemeral", ttl: "1h"}` at the top level (per `CLAUDE_CACHE_TTL`; omit when `off`). Summarize: omit. |
| `fallbacks` and `betas` | When the model's flag and the global switch are on: `fallbacks: "default"`, `betas: [CLAUDE_FALLBACK_BETA]`. Otherwise omit both. |
| `output_config` | Only `{effort}` when the registry sets one |
| `thinking`, `temperature`, `top_p`, `top_k`, `tools`, `tool_choice`, `stop_sequences` | Never sent |

Sketch (not compiled; method, option and event names are from the SDK source at 1.11.0):

```ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }); // defaults: maxRetries 2, timeout 10 min

const stream = client.beta.messages.stream(
  {
    model: model.id,
    max_tokens: maxTokens,
    system,
    messages,
    ...(cacheTtl !== "off" && kind === "continue" ? { cache_control: { type: "ephemeral", ttl: cacheTtl } } : {}),
    ...(model.effort ? { output_config: { effort: model.effort } } : {}),
    ...(useFallbacks ? { fallbacks: "default" as const, betas: [fallbackBeta] } : {}),
  },
  { signal: turn.abort.signal },
);

stream.on("text", (delta) => turn.onText(delta));           // append to turn.text, forward as a delta event
stream.on("streamEvent", (event) => {
  if (event.type === "content_block_start" && event.content_block.type === "fallback") {
    turn.onFallback(event.content_block.from.model, event.content_block.to.model);
  }
});

const final = await stream.finalMessage();                  // rejects on API error, abort, or a stream without message_stop
// final.stop_reason, final.stop_details, final.model (the model that answered), final.usage
```

Facts about the SDK that matter here:

- `client.beta.messages.stream()` works with or without `betas`; one code path serves all models.
- The reply text is the concatenation of the `text` deltas, which equals joining the final message's `text` blocks with the empty string. Do not use `stream.finalText()`: it joins blocks with a space and throws when there is no text block.
- The SDK `timeout` covers only the time until response headers arrive. It does not limit a stream. The server needs its own deadline (C9).
- SDK retries (2 by default, for connection errors, 408, 409, 429 and 5xx, honouring `retry-after`) happen only before the stream starts. Keep the default.
- An `error` event inside the stream is thrown as an `APIError` whose `status` is undefined and whose `type` carries the API error type. Connection errors also have no status. Check the classes in this order: `APIUserAbortError`, `APIConnectionTimeoutError`, `APIConnectionError`, then `APIError` by `status`, `type` and `errorCode`. Any other error from `finalMessage()` means the stream ended early.
- Pin the SDK major version. Anthropic ships API version changes as SDK major versions. The SDK needs Node.js 20 or later.

### C5. Turn lifecycle and persistence

A "turn" is one Claude request for one session: one chat exchange or one Summarize request. The browser gives each turn a random UUID, `clientTurnId`, the name web-platform.md 9.4 uses. web-platform.md asks that an in-flight or interrupted turn can be represented on the server; data-model.md 7.2 has no table for that, so this document proposes one:

```sql
CREATE TABLE claude_turns (
  id                    uuid PRIMARY KEY,              -- the browser's clientTurnId
  owner_id              uuid NOT NULL REFERENCES owners (id) ON DELETE CASCADE,
  session_id            uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  kind                  text NOT NULL,                 -- 'continue' | 'summarize'
  status                text NOT NULL,                 -- 'running' | 'saved' | 'truncated' | 'refused' | 'empty'
                                                       -- | 'cancelled' | 'failed' | 'interrupted'
  persisted             boolean NOT NULL DEFAULT false, -- messages or the summary were written
  attempts              integer NOT NULL DEFAULT 1,
  requested_model       text NOT NULL,
  served_model          text NOT NULL DEFAULT '',
  user_text             text NOT NULL DEFAULT '',      -- chat: the user's text until it becomes a message
  draft_text            text NOT NULL DEFAULT '',      -- Summarize: an unsaved truncated draft (C7)
  stop_reason           text NOT NULL DEFAULT '',
  refusal               jsonb,                         -- {category, explanation, recommendedModel}
  error_code            text NOT NULL DEFAULT '',
  error_message         text NOT NULL DEFAULT '',
  upstream_request_id   text NOT NULL DEFAULT '',
  preflight_input_tokens integer,
  usage                 jsonb,                         -- final usage object, including iterations
  cancel_requested      boolean NOT NULL DEFAULT false,
  user_message_id       uuid,                          -- rows written by this turn
  assistant_message_id  uuid,
  started_at            timestamptz NOT NULL DEFAULT now(),
  heartbeat_at          timestamptz NOT NULL DEFAULT now(),  -- refreshed while running
  finished_at           timestamptz
);
CREATE UNIQUE INDEX claude_turns_one_running_per_session ON claude_turns (session_id) WHERE status = 'running';
CREATE INDEX claude_turns_owner_started_idx ON claude_turns (owner_id, started_at);
```

- The partial unique index is the lock: a second running turn for the same session fails on insert. If the hosting platform's schema tooling cannot keep a partial index (check 4 in web-platform.md 13.1), take the session row `FOR UPDATE` and test for a running row inside one transaction.
- The table is also the limiter state (C9), the usage record, and the place where the user's text lives until there is a reply. `user_text` and `draft_text` are transcript text: treat them like `messages.text` for encryption and logging. Finished rows may be pruned after 30 days.

Why the user's text is not inserted into `messages` first: web-platform.md 9.4 says "the server stores the user message together with that id". Here it is stored in the turn row and becomes a message row in the same transaction as the reply. Every goal of that section still holds (one user message per `clientTurnId`, retry without duplication, state on the server), and the transcript never contains an unanswered or refused user message, which is defect B5.

What a `POST` with a given `clientTurnId` does (the idempotent send of web-platform.md 9.4):

| Row for this id | Action |
|---|---|
| none | Start a new turn. |
| `running` | Answer `409 turn_in_progress`. |
| finished and `persisted` | Answer `200` with a stream that contains only `done`, rebuilt from the row and the stored messages. Nothing is generated. |
| finished and not `persisted` | Retry: set the row back to `running`, add 1 to `attempts`, set `started_at` and `heartbeat_at` to now, clear the error fields, keep `user_text` from the row (the body's `text` is ignored), take `model` from the body. |

Chat turn, in order:

1. Authenticate the owner (web-platform.md). Validate the body. Load the session and its messages with the transcript query of data-model.md 7.3.
2. Apply the table above. Check the app limits (C9). On failure answer with JSON and stop.
3. Insert the turn row (or reset it) with status `running` and `user_text`, and start the turn heartbeat described below. A unique violation on the partial index means `turn_in_progress`.
4. Build the messages (C3) from the stored messages and `user_text`. Run the pre-flight size check (C9). If it rejects, delete the turn row, answer with JSON and stop.
5. If `cancel_requested` is already set, finish as cancelled.
6. Open the SSE response and send `start`. Start the `: ping` timer and the deadline timer.
7. Call upstream (C4). Forward each text delta. Keep the accumulated text in memory.
8. When the upstream call ends, classify the outcome (C7). In one database transaction: when the outcome says "commit", append the user message and then the assistant message with the append statement of data-model.md 7.3 (it locks the session row, assigns the next position and maintains the counters), set `model` and `created_at` on both, and update the turn row. Otherwise only update the turn row.
9. Send `done` or `error` and end the response.

Rules that hold throughout:

- A dropped browser connection is not a stop. If writing to the response fails or the socket closes, continue steps 7 and 8 without writing. This reproduces the Apple behaviour (the reply is saved even when the sheet is closed) and matters on phones, where background tabs lose connections. Whether the hosting platform lets the process keep working after the response has ended, and how long one response may last, is unverified; see web-platform.md 9.2, 9.4 and checks 2 and 3 in its section 13.1. If work stops, the heartbeat stops and the turn becomes `interrupted`.
- Heartbeat and stale turns (web-platform.md 9.4 rule 2): while a turn runs, every 2 seconds execute `UPDATE claude_turns SET heartbeat_at = now() WHERE id = $1 RETURNING cancel_requested`. A row that is `running` with a `heartbeat_at` older than 60 seconds belongs to a process that died: set it to `interrupted` at server start, before starting a turn for that session, and when the turn route is read. The interface then shows the stored `user_text` with a Retry action, which sends the same `clientTurnId` again.
- Stop is explicit: `POST /api/sessions/:id/stop` sets `cancel_requested` on the session's running turn and, when that turn lives in this process, aborts the upstream stream at once. The heartbeat statement returns the flag, so Stop also works when another process received it.
- When the deadline passes, abort upstream and finish with the error `upstream_timeout`.
- The SSE response is opened before the model call so that heartbeats flow while Anthropic processes a large prompt. Failures of the model call therefore reach the browser as `error` events, not as HTTP statuses. Only failures in steps 1 to 5 are JSON responses.
- One server process is assumed (web-platform.md recommends one machine). With several, the lock, the limits and the stop flag still work because they live in Postgres; only immediate aborts and `partialText` are per process.
- Never write transcript text or the key to logs. Log turn id, session id, model, outcome, duration, token usage and the upstream request id. Do not enable SDK debug logging in production; it prints request bodies.

Summarize turn: the same steps with `kind = 'summarize'` and no `user_text`. In step 2, after the table, an empty transcript is `nothing_to_summarize` and an existing summary without `replaceExisting` is `summary_exists`; a repeated send of a finished, persisted turn still replays `done`. Step 8 writes `sessions.summary` (and the session's search text, data-model.md 8.1) when the outcome says "save", or `draft_text` when the result is a truncated draft.

Stored fields this flow sets:

- `messages.model`: the model that answered (`final.model`), on the assistant message; empty on the user message.
- `messages.created_at`: the commit time, on both.
- `messages.extra`: for an incomplete assistant message, `{"claude": {"incomplete": "truncated" | "cancelled", "stopReason": "<stop reason or empty>"}}`. How `extra` travels in the interchange format is data-model.md's rule.
- `sessions.model`: data-model.md (B11 and decision 6) proposes filling it only when it is empty. No importer sets that label, so "only when empty" would still stamp a Claude model id on sessions from other providers. Rule here: set it to the answering model only when it is empty and the session's provider is `claude`; otherwise leave it. This replaces "updates the session's model name" in web-platform.md 9.4 rule 4.

### C6. HTTP contract between browser and server

All routes require the signed-in owner and are same-origin; the cross-site and cookie rules are in web-platform.md 11. Paths follow web-platform.md 9.3. Errors before a stream starts are JSON: `{"error": {"code", "message", "retryable", "retryAfterSeconds", "details"}}` with the status from C8. The `postSse` helper in web-platform.md 9.3 throws on any status other than 200; extend it to read this JSON body first.

`GET /api/claude/config`

```json
{
  "configured": true,
  "keyStatus": "ok",
  "defaultModel": "claude-opus-5-5",
  "summarizeModel": "claude-opus-5-5",
  "models": [
    {"id": "claude-opus-5-5", "name": "Claude Opus 5.5", "contextWindow": 1000000},
    {"id": "claude-fable-5-2", "name": "Claude Fable 5.2", "contextWindow": 1000000},
    {"id": "claude-sonnet-5-5", "name": "Claude Sonnet 5.5", "contextWindow": 1000000},
    {"id": "claude-haiku-5-5", "name": "Claude Haiku 5.5", "contextWindow": 1000000}
  ],
  "limits": {"confirmAboveInputTokens": 100000, "maxUserTextChars": 200000}
}
```

`configured` is false when the server has no key; `keyStatus` is `ok`, `rejected` or `unknown` (C2). When `configured` is false the client replaces the chat composer and the Summarize action with a notice (C8, `not_configured`).

`POST /api/sessions/:id/continue`

```json
{"clientTurnId": "00000000-0000-4000-8000-00000000e001", "text": "How often should I water mint?",
 "model": "claude-opus-5-5", "confirmLargeInput": false}
```

Use a fresh `clientTurnId` for every new message. Reuse it only to repeat or retry the same message (table in C5). Success is `200` with `Content-Type: text/event-stream` (events below).

`POST /api/sessions/:id/summarize`

```json
{"clientTurnId": "00000000-0000-4000-8000-00000000e002", "model": "claude-opus-5-5",
 "replaceExisting": false, "confirmLargeInput": false}
```

`model` is optional (default `summarizeModel`). If the session has a non-empty summary and `replaceExisting` is not true, answer `409 summary_exists` before spending anything.

`POST /api/sessions/:id/stop` answers `200 {"stopped": true}` when a running turn was flagged and `200 {"stopped": false}` when the session has none. Calling it again is harmless. The turn row may not exist yet when Stop is pressed at once, so while its own send is still pending the client repeats a `false` answer a few times, half a second apart.

`GET /api/sessions/:id/turn` answers `{"turn": null}` or the session's latest turn: `{"turn": {"clientTurnId", "kind", "status", "persisted", "requestedModel", "servedModel", "startedAt", "finishedAt", "userText", "draftText", "partialText", "errorCode", "errorMessage", "refusal"}}`. A client that lost its stream polls this every 2 seconds while `status` is `running`, then reloads the session. `partialText` is the text so far when the turn lives in the answering process, else null.

Stream format, as in web-platform.md 9.3. Each event is three lines: `event: <name>`, `data: <one line of JSON>`, and an empty line. The server also sends the comment line `: ping` followed by an empty line whenever 15 seconds pass without an event. Response headers: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`; no compression on these routes; flush the headers immediately.

| Event | Data | Meaning |
|---|---|---|
| `start` | `{"clientTurnId", "kind", "requestedModel", "preflightInputTokens"}` | The turn is accepted; the upstream call is starting. `preflightInputTokens` is null when no count was needed. |
| `delta` | `{"text"}` | Append to the reply being shown. |
| `fallback` | `{"fromModel", "toModel"}` | Another model took over after a refusal. Informational. |
| `done` | see below | Final. The stream ends after it. |
| `error` | `{"clientTurnId", "code", "message", "retryable", "retryAfterSeconds", "upstream": {"status", "type", "errorCode", "message", "requestId"}}` | Final. Nothing was saved. |

`done` data:

```json
{
  "clientTurnId": "00000000-0000-4000-8000-00000000e001",
  "outcome": "saved",
  "persisted": true,
  "stopReason": "end_turn",
  "requestedModel": "claude-opus-5-5",
  "servedModel": "claude-opus-5-5",
  "userMessage": {"id": "00000000-0000-4000-8000-00000000a008", "index": 8, "role": "user",
                  "text": "How often should I water mint?"},
  "assistantMessage": {"id": "00000000-0000-4000-8000-00000000a009", "index": 9, "role": "assistant",
                       "text": "Water mint twice a week.", "model": "claude-opus-5-5"},
  "summary": null,
  "previousSummary": null,
  "refusal": null,
  "usage": {"inputTokens": 12, "cacheCreationInputTokens": 1834, "cacheReadInputTokens": 0, "outputTokens": 215}
}
```

- `outcome` is one of `saved`, `truncated`, `refused`, `empty`, `cancelled` (C7).
- `userMessage` and `assistantMessage` are the committed rows, or null when nothing was committed. The example abbreviates them; use the same message shape as the rest of the session API (data-model.md).
- `summary` (Summarize only) holds the text: the saved summary, or the unsaved draft when `persisted` is false. `previousSummary` holds the text that was replaced, so the interface can offer Undo.
- `refusal`, when the outcome is `refused`: `{"category", "explanation", "recommendedModel"}`, each possibly null.
- Unknown event names and unknown fields must be ignored by the client.

The SDK also offers `stream.toReadableStream()` on the server and `MessageStream.fromReadableStream()` in the browser, which relay Anthropic's raw events. Do not use that pair here: it puts the SDK in the browser bundle, exposes raw upstream events, and leaves no room for the app's own events (saved rows, mapped errors, heartbeat).

Browser rules, in addition to web-platform.md 9.5:

- Use `fetch` with `getReader()`; `EventSource` cannot send a POST. Decode with `TextDecoder` in streaming mode so a multi-byte character split across chunks survives. Split events on an empty line, tolerate `\r\n`, ignore lines that start with `:`.
- If the response is not `text/event-stream`, parse it as the JSON error.
- If the stream ends without `done` or `error`, do not assume failure or success: poll the turn route.
- Stop button: call the stop route and keep reading until `done` arrives. Do not abort the fetch first; if the stream is already gone, poll the turn route.
- Show the user's message and the waiting indicator immediately. On `refused`, `empty`, `error`, or `cancelled` with `persisted` false, remove the optimistic user bubble and put the text back in the composer; sending it again unchanged reuses the `clientTurnId`, sending an edited text uses a new one. On a mid-stream `error`, keep the partial text on screen, marked as interrupted, until the user retries or dismisses it; it is not stored.
- On opening a session, read the turn route: a `running` turn shows the stored `userText` as a pending message and polls; a turn that is `failed` or `interrupted` within the last day offers Retry and Discard.
- Render deltas at most once per animation frame.
- The service worker must not handle `/api/` requests (web-platform.md).
- Claude actions are unavailable offline.

### C7. Outcome rules

`text` is the accumulated reply trimmed with `trim()`.

| Condition | Chat | Summarize |
|---|---|---|
| Stop reason `end_turn` or `stop_sequence`, or a value this table does not know, and `text` not empty | Commit the user and assistant messages. Outcome `saved`. | Save the summary. Outcome `saved`. |
| `max_tokens` or `model_context_window_exceeded`, `text` not empty | Commit both; mark the assistant message truncated. Outcome `truncated`, `persisted` true. The interface says the reply was cut off and offers to send `Please continue from where you left off.` as the next message. | Do not save the summary. Store the text in the turn's `draft_text`. Outcome `truncated`, `persisted` false, draft in `summary`. The interface offers to keep the draft (an ordinary summary update) or discard it. |
| `refusal`, with or without text | Commit nothing; discard the text. Outcome `refused`. | Commit nothing. Outcome `refused`. |
| Any stop reason, `text` empty | Commit nothing. Outcome `empty`. | Commit nothing. Outcome `empty`. |
| Stopped by the user, `text` not empty | Commit both; mark the assistant message cancelled. Outcome `cancelled`, `persisted` true. | Do not save. Outcome `cancelled`, `persisted` false. |
| Stopped by the user, `text` empty | Commit nothing. Outcome `cancelled`, `persisted` false. | same |
| Upstream error, early end of stream, deadline | Commit nothing. `error` event. | same |

Evaluate in this order, first match wins: stopped by the user; no stop reason on the final message (error `stream_interrupted`); `refusal`; empty text; truncation; saved.

`tool_use`, `pause_turn` and `compaction` cannot occur because no tools or compaction are requested; if one appears, log it and treat it as an unknown value.

Messages for the non-error outcomes:

| Outcome | Text |
|---|---|
| `refused` | `Claude declined this request.` followed by the API's explanation when present. With `recommendedModel`: `Try again with <model name>.` Do not resend automatically. |
| `empty` (chat) | `Claude returned no text (stop reason: <stopReason>). Nothing was saved.` |
| `empty` (Summarize) | `Claude returned no summary.` |
| `truncated` | `This reply was cut off by the length limit.` |
| `cancelled` | No message. A stopped reply is shown with the label `Stopped`. |

### C8. Error surface

Map every failure to one of these codes. The browser shows the fixed message; the upstream message and request id go into a details line. The status column applies when the failure happens before the stream opens (validation, app limits, pre-flight including the token count call); the same codes appear in `error` events afterwards. Upstream failures use status 502, 503 or 504, never 401, so the client cannot mistake a bad Anthropic key for an expired app login.

| Code | When | HTTP status before the stream | Retryable | Message |
|---|---|---|---|---|
| `not_configured` | No `ANTHROPIC_API_KEY` | 503 | no | `Claude is not set up on this server. Add an Anthropic API key to the server's secrets.` |
| `validation` | Blank or too long text, unknown model, malformed body | 400 | no | Specific to the field |
| `nothing_to_summarize` | The transcript is empty | 400 | no | `This session has no messages to summarize.` |
| `summary_exists` | Summary present and `replaceExisting` false | 409 | no | Client asks `Replace the existing summary?` |
| `turn_in_progress` | A turn is already running for the session, with this or another `clientTurnId` | 409 | no | `Claude is already working on this session.` The client polls the turn route. |
| `confirmation_required` | Input above the confirmation threshold | 409 | no | Client shows the size and estimate, then repeats the request with `confirmLargeInput: true`. `details`: `{"inputTokens", "estimated", "threshold", "model", "contextWindow", "estimatedInputCostUsd"}` |
| `input_too_large` | Pre-flight above the hard limit; upstream 400 whose message says the prompt is too long; upstream 413 | 413 | no | `This session is too long for <model name>: about <n> tokens, limit <m>.` |
| `app_rate_limited` | App limits in C9 | 429 | yes | `Too many Claude requests. Wait a moment and try again.` |
| `auth_failed` | Upstream 401 | 502 | no | `The server's Anthropic API key was rejected. It may be wrong, disabled or expired.` |
| `billing` | Upstream 402 | 502 | no | `Anthropic reports a billing problem with the API account.` |
| `permission_denied` | Upstream 403 | 502 | no | `The API key is not allowed to do this.` |
| `model_unavailable` | Upstream 404 | 502 | no | `The model <id> is not available to this API key.` |
| `spend_limit` | Upstream 429 with error code `enforced_spend_limit_reached` or `contract_spend_limit_reached` | 502 | no | `The Anthropic account has reached its spend limit.` |
| `rate_limited` | Any other upstream 429 | 503 | yes | `Anthropic is limiting requests for this account. Try again in <n> seconds.` with `retry-after` when present |
| `overloaded` | Upstream 529, or type `overloaded_error` inside the stream | 503 | yes | `Claude is overloaded right now. Try again shortly.` |
| `upstream_timeout` | Upstream 504 or type `timeout_error`; SDK connection timeout; the turn deadline | 504 | yes | `The request to Claude timed out.` |
| `upstream_error` | Other upstream 5xx; type `api_error` | 502 | yes | `Anthropic had a server error. Try again.` |
| `network` | SDK connection error | 502 | yes | `The server could not reach Anthropic.` |
| `stream_interrupted` | The stream ended without a final message | 502 | yes | `The reply was interrupted before it finished.` |
| `upstream_rejected` | Any other upstream 400 | 502 | no | `Claude rejected the request.` plus the upstream message |

Order of checks for an error thrown by the SDK, first match wins (`s` is `status`, `t` is `type`, `c` is `errorCode`; any of them can be missing):

1. `APIUserAbortError`: the turn was stopped by the user (outcome `cancelled`, not an error, see C7) when stop was requested; `upstream_timeout` when the deadline fired; otherwise `stream_interrupted`.
2. `APIConnectionTimeoutError`: `upstream_timeout`.
3. `APIConnectionError`: `network`.
4. Any other `APIError`:
   1. `c` is `enforced_spend_limit_reached` or `contract_spend_limit_reached`: `spend_limit`
   2. `s` is 401 or `t` is `authentication_error`: `auth_failed`
   3. `s` is 402 or `t` is `billing_error`: `billing`
   4. `s` is 403 or `t` is `permission_error`: `permission_denied`
   5. `s` is 404 or `t` is `not_found_error`: `model_unavailable`
   6. `s` is 413 or `t` is `request_too_large`: `input_too_large`
   7. `s` is 429 or `t` is `rate_limit_error`: `rate_limited`
   8. `s` is 529 or `t` is `overloaded_error`: `overloaded`
   9. `s` is 504 or 408, or `t` is `timeout_error`: `upstream_timeout`
   10. `s` is 500 or above, or `t` is `api_error`: `upstream_error`
   11. `s` is 400 or `t` is `invalid_request_error`: `input_too_large` when the message contains "prompt is too long", otherwise `upstream_rejected`
   12. anything else: `upstream_error`
5. Any other thrown value: `stream_interrupted`.

Notes:

- The only place a message string is inspected is the "prompt is too long" case, as a convenience; when it does not match, the result is `upstream_rejected` with the upstream text, which is still clear.
- A spend limit set by the account owner in the Claude Console arrives as a 400 with an explanatory message and no code; it lands in `upstream_rejected`.
- The Fable models require the organisation to keep data for 30 days. Without that, every request to them is a 400 with an explanatory message; it also lands in `upstream_rejected`.
- If the beta header is ever retired, every request to a model with the fallback flag fails with a 400 about an unexpected `anthropic-beta` value. Log this prominently; the fix is `CLAUDE_SERVER_SIDE_FALLBACKS=off` or a new `CLAUDE_FALLBACK_BETA`.

### C9. Limits and cost guards

Pre-flight size check, for both features:

1. `limit` = `model.contextWindow - 8000`, lowered to `CLAUDE_MAX_INPUT_TOKENS` when that is set and smaller. `threshold` = `CLAUDE_CONFIRM_ABOVE_INPUT_TOKENS`.
2. `bound` = UTF-8 byte length of the system prompt and of all message texts + 16 per message + 64. A token covers at least one byte, so `bound` is an upper limit for the token count (inference; the per-message allowance is a guess at framing overhead).
3. If `bound` is at most `min(threshold, limit)`, skip counting: the request is certainly under both.
4. Otherwise call `client.messages.countTokens({model, system, messages})` with the model that will be used. If that call fails with a retryable error (rate limit, overload, server error, network), use `ceil(characters / 2.5)` and mark the number as estimated. If it fails with any other error (for example a rejected key or an unavailable model), stop with the mapped error from C8.
5. If the count exceeds `limit`, reject with `input_too_large`.
6. If the count exceeds `threshold` and `confirmLargeInput` is not true, reject with `confirmation_required`, including a cost estimate when the registry has prices (first message with the configured cache TTL, and a later cached message). The client remembers the confirmation for the open chat and sends `confirmLargeInput: true` on later turns.

Other guards:

| Guard | Rule |
|---|---|
| New message length | At most `CLAUDE_MAX_USER_TEXT_CHARS`; request body limit 512 KB on these routes |
| Message count | The API accepts at most 100,000 messages in one request; reject more with `input_too_large` |
| One turn at a time per session | The partial unique index in C5 |
| Concurrency | At most `CLAUDE_MAX_CONCURRENT_TURNS` rows with status `running` for the owner |
| Rate | At most `CLAUDE_MAX_TURNS_PER_10_MIN` rows started in the last 10 minutes |
| Daily | At most `CLAUDE_MAX_TURNS_PER_DAY` rows started since 00:00 UTC |
| Output | `max_tokens` as in C4 |
| Time | `CLAUDE_REQUEST_DEADLINE_MS` wall clock per turn, enforced by the server with an abort; the SDK's own timeout only bounds the wait for response headers |
| Authentication | Every Claude route requires the owner; cross-site requests are refused (web-platform.md) |

The authoritative spend guard is outside the app: the owner should create a dedicated workspace and API key for this server in the Claude Console and set a monthly spend limit there. The app limits are a second line of defence against a client bug or a stolen login.

Very long sessions:

- A 1,000,000-character session is about 400,000 tokens by the documented ratio of 2.5 characters per token; code-heavy text can need more. It fits all four current models. It does not fit a 200,000-token model.
- It will trigger the confirmation dialog. Typical costs are in the table before Part C.
- Rate limits can bite: on the Start tier `claude-fable-5-2` allows 500,000 input tokens per minute, so two uncached requests of this size within a minute cannot both pass; new accounts can be below the Start tier and can hit ramp limits. These arrive as `rate_limited`.
- The documentation warns that accuracy degrades as context grows. A later version can offer "continue from the summary" for such sessions (C12).

Hosting limits: how long the platform lets one response run, and whether work continues after the browser has gone, are open (web-platform.md 9.2 and 13.1). If those checks show a limit below the 20-minute deadline, lower `CLAUDE_REQUEST_DEADLINE_MS` and `CLAUDE_MAX_OUTPUT_TOKENS` so a reply fits, or use an always-on deployment. Nothing else in this document depends on the answer: a turn that is cut off ends as `interrupted` and can be retried.

### C10. Prompt caching rules

1. Chat requests carry top-level `cache_control` with the configured TTL. Summarize requests carry none: a single request never reads its own cache, and the write premium would be wasted.
2. The prefix must be identical from one turn to the next. That is guaranteed when: the system prompt is a constant; messages come from the database in a fixed order; texts are passed through unchanged; nothing variable (time, title, ids) is added; the model, the effort and the thinking settings do not change during a chat.
3. Changing the model during a chat is allowed and simply misses the cache once.
4. Record `usage` for every turn. In a healthy chat the second message within the TTL shows `cache_read_input_tokens` close to the whole previous prompt and a small `cache_creation_input_tokens`. If reads stay at zero, something in rule 2 is broken. This cannot be proven against a fake upstream; it is a manual check with a real key (C11).
5. Prompts under the model's minimum (512 tokens on the four current models) are not cached, without any error.
6. Optional refinement: also put an explicit `cache_control` with the same TTL on the last stored message's text block, so that a retry with an edited message, or a new message after a refusal, still reads the transcript from the cache.

### C11. Tests against a mocked upstream

No test may reach Anthropic. Build the Claude service with an injected client: `new Anthropic({ apiKey: "test-key-EXAMPLE", fetch: fakeFetch, maxRetries: 0 })`. `fakeFetch` records the URL, headers and parsed JSON body, throws on any URL it does not expect, and returns a `Response` whose body is a scripted byte stream with `content-type: text/event-stream` and a `request-id` header. Match requests on the path (`/v1/messages`, `/v1/messages/count_tokens`, `/v1/models`); the beta namespace may add a query string. Continuous integration has no `ANTHROPIC_API_KEY`.

Every script must carry `usage` on the `message_start` message and on every `message_delta`: the SDK reads both without a guard, and a script without them fails inside the SDK, not in the code under test.

Baseline script U1 (shapes follow the documented stream format; ids are fake):

```text
event: message_start
data: {"type":"message_start","message":{"id":"msg_EXAMPLE01","type":"message","role":"assistant","content":[],"model":"claude-opus-5-5","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":25,"output_tokens":1}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"EXAMPLEsignature"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: ping
data: {"type":"ping"}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Water mint "}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"twice a week."}}

event: content_block_stop
data: {"type":"content_block_stop","index":1}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":15}}

event: message_stop
data: {"type":"message_stop"}

```

Expected from the app: `start`, `delta` "Water mint ", `delta` "twice a week.", `done` with outcome `saved`; two messages committed; assistant text `Water mint twice a week.`

Variants (U2 and U3 are built from the documented shapes, not captured from the API):

| Script | Change from U1 | Expected |
|---|---|---|
| U2 refusal before output | After `message_start`, only a `message_delta` with `"delta":{"stop_reason":"refusal","stop_sequence":null,"stop_details":{"type":"refusal","category":"cyber","explanation":"EXAMPLE explanation"}},"usage":{"output_tokens":0}`, then `message_stop` | `done` `refused`; nothing committed; explanation passed through |
| U3 fallback in mid-output | `message_start` names `claude-fable-5-2`; text block 0 "Step one"; block 1 is `{"type":"fallback","from":{"model":"claude-fable-5-2"},"to":{"model":"claude-opus-4-8"},"trigger":{"type":"refusal","category":"cyber"}}` with start and stop only; text block 2 " and step two."; `end_turn` | A `fallback` event; text `Step one and step two.`; `servedModel` `claude-opus-4-8` |
| U4 refusal after text | Text delta, then `message_delta` with `refusal` | `done` `refused`; nothing committed |
| U5 `max_tokens` | `stop_reason` `max_tokens` | `truncated`, `persisted` true (chat) or false with a draft (Summarize) |
| U6 thinking used the whole budget | No text block, `stop_reason` `max_tokens` | `empty` |
| U7 error inside the stream | After one text delta: `event: error` with `data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}` | `error` event `overloaded`; nothing committed |
| U8 stream cut | Close the body after one text delta | `error` event `stream_interrupted` |
| U9 unknown event | Insert `event: future_event` with `data: {"type":"future_event"}` | Same result as U1 |
| U10 never ends | Text delta, then the body stays open | Stop route called: upstream signal aborted, `done` `cancelled`, partial text committed and marked. Deadline (short test value): `error` `upstream_timeout`. |

HTTP error cases, each a JSON body `{"type":"error","error":{"type":"...","message":"..."},"request_id":"req_EXAMPLE02"}` with the given status: 400 with a "prompt is too long" message; 400 other; 401; 402; 403; 404; 413; 429 with `retry-after: 7`; 429 with `"details":{"error_code":"enforced_spend_limit_reached"}`; 500; 529. Assert the code, the HTTP status and the retry hint from C8.

Request assertions:

- The body for the A13 fixture equals the expected web messages; `system` equals the constant; `max_tokens` is 64000; there is no `thinking`, `temperature`, `top_p`, `top_k` or `tools` key.
- Chat requests have `cache_control` with the configured TTL; Summarize requests have none.
- `fallbacks` and the beta header are present exactly for models whose flag is on. Read headers through `new Headers(init.headers)`; the key arrives as `Authorization: Bearer test-key-EXAMPLE`.
- The pre-flight path calls `count_tokens` only above the byte bound, and rejects with `confirmation_required` and `input_too_large` at the right numbers.
- The string `test-key-EXAMPLE` appears in no response body, event or log line.

State assertions: two sends for one session with different ids while the first is running, the second gets `turn_in_progress`; a repeated send with the same `clientTurnId` after a saved reply answers `done` without an upstream call; a repeated send after a failure regenerates from the stored text and commits exactly one user message; a refused or failed chat leaves the message table unchanged; positions are consecutive after a commit and the session counters of data-model.md 7.3 still agree; a client that disconnects during U1 still finds both messages committed; Summarize with an existing summary and `replaceExisting` false makes no upstream call.

Browser parser tests: an event split across chunks; a multi-byte character split across chunks; `\r\n` line ends; comment lines; a stream that ends without a final event.

Manual checks with a real key, once, by the owner: each configured model answers a one-line prompt; the second message of a chat on a session longer than about 2,000 characters reports cache reads above zero; Stop ends a reply within about a second; a deliberately wrong key produces `auth_failed`.

### C12. Not in the first version

- Server-side compaction, message threads, batches, tools, files and extended output: none is needed, and compaction would require storing non-text blocks in the vault.
- Showing thinking summaries (`thinking.display: "summarized"`).
- "Continue from the summary": for sessions above the confirmation threshold, send the saved summary plus the new messages in place of the full transcript. Cheaper and faster, loses detail.
- Sharing one cached prefix between chat and Summarize by sending the summarize instruction as a final user message after the same system prompt and messages. It changes the Summarize prompt, so it needs its own evaluation.
- An "Extract code" action. The earlier iOS code has such a prompt for an on-device model (`reference/session-capture-ios/SessionCapture/Summarizer.swift:45-51`); it never called Claude.

### C13. If the working assumptions change

If instead the vault lives only in the browser (IndexedDB, no server vault):

- The server cannot load the transcript. The browser sends the stored messages with the request and commits the result itself. The Claude routes become one stateless proxy, for example `POST /api/claude/stream` with `{clientTurnId, task, model, messages: PromptMessage[], text, confirmLargeInput}`. The server still runs C3, C4, C7, C8 and C9, so prompts and limits stay server-controlled.
- Allow request bodies up to about 16 MB on that route; a 1,000,000-character transcript is several megabytes of JSON.
- There is no place to save a reply when the browser is gone, so a dropped connection must abort the upstream call. The turn journal shrinks to a usage table without a session reference, and the one-turn-per-session rule is enforced only in the client.

If instead the key is a bring-your-own key kept in the browser:

- Recommended form: keep the server proxy and send the key with each request in a header over HTTPS; the server creates a client for that request and never stores or logs the key. Everything else in Part C is unchanged.
- The other form, calling `https://api.anthropic.com` from the browser (the one web-platform.md section 14 describes), is possible but worse. Facts from the docs: the API accepts cross-origin browser requests only with the header `anthropic-dangerous-direct-browser-access: true`, which the TypeScript SDK sends when `dangerouslyAllowBrowser` is true; organisations with zero data retention or the Compliance API are refused even then, with a 401 whose message begins `CORS requests are not allowed for this Organization`. All of C5 to C9 would have to run in the browser, with no server guards and nothing to save a reply when the tab is suspended.
- The key entry screen from A11 is needed again, with its wording corrected ("stored in this browser", keys are created at `platform.claude.com/settings/keys`), plus what the Apple app lacks: Replace key, Remove key, and a check on save (a Models API call through the server; a 401 means the key is wrong).
- A key in browser storage can be read by any script injected into the page. The Markdown rendering of transcripts and replies must be sanitised without exception (design.md, web-platform.md).

The other two assumptions (TypeScript stack, interchange with the Apple app) do not change this area. Messages created by Claude carry the answering model in the interchange field the draft schema already defines.

### C14. Decisions that are the owner's, with the default to build until answered

| Decision | Default in this document |
|---|---|
| Which models to offer, and the default | The four current ids; default `claude-opus-5-5`. `claude-fable-5-2` costs twice as much per token; `claude-haiku-5-5` is the cheapest. |
| Which Anthropic account pays | The owner's own API key as a server secret, as the Apple app uses today, with a monthly spend limit set in the Claude Console. Not the hosting platform's managed integration. |
| Cache lifetime for chats | One hour: the first message of a chat costs double the normal input price, later messages within the hour cost a twentieth of it on the default model. Cheaper when a chat has three or more messages; dearer for a single question. |
| Summary field | One field, as today; Summarize asks before replacing existing text. The alternative is a separate field for the generated summary. |
| Session model label after continuing (decision 6 in data-model.md) | The answering model is stored on each new message. The session label is filled only when it is empty and the session's provider is Claude. The Apple app always overwrites it. |
| Stop during a reply | The partial reply is kept and marked as stopped. The alternative is to discard it. |
| Thresholds | Ask before sending more than 100,000 tokens; at most 30 turns per 10 minutes and 300 per day. |
| Disclosure | Continue and Summarize send the whole stored transcript, including sessions that came from other providers, to Anthropic through the server. The Apple app does the same from the device without saying so. Show a short notice the first time. |

## Sources

Read on 2026-11-19.

- Repository: `apple/SessionVault/ClaudeAPI.swift`, `apple/SessionVault/ContextPack.swift`, `apple/SessionVault/Models.swift`, `apple/SessionVault/Views/ContinueChatView.swift`, `apple/SessionVault/Views/SessionDetailView.swift`, `apple/SessionVault/Views/RootView.swift`, `apple/README.md`, `reference/session-capture-ios/SessionCapture/Summarizer.swift`.
- Anthropic documentation under `https://platform.claude.com/docs/en/`: `models/overview`, `about-claude/model-deprecations`, `about-claude/pricing`, `api/overview`, `api/versioning`, `api/migration-2026-10-21`, `api/errors`, `api/rate-limits`, `api/messages/create`, `api/beta/messages/create`, `api/models/list`, `manage-claude/authentication`, `build-with-claude/streaming`, `build-with-claude/handling-stop-reasons`, `build-with-claude/refusals-and-fallback`, `build-with-claude/prompt-caching`, `build-with-claude/token-counting`, `build-with-claude/context-windows`, `build-with-claude/thinking`, `build-with-claude/effort`, `build-with-claude/compaction`, `cli-sdks-libraries/sdks/typescript`, `release-notes/overview`.
- `https://github.com/anthropics/anthropic-sdk-typescript` at version 1.11.0: `README.md`, `helpers.md`, `examples/fallbacks.ts`, `src/core/error.ts`, `src/core/streaming.ts`, `src/lib/MessageStream.ts`, `src/lib/BetaMessageStream.ts`, `src/client.ts`, `src/resources/beta/messages/messages.ts`.
- The Claude API reference bundled with Claude Code (cache date 2026-11-03), used as a cross-check.
