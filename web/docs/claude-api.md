# Claude API: what the Apple app does and what the web app should do

> **Status (revised 2026-11-20).** Extracted from the Apple app's source, then revised on 2026-11-20 for the decisions in `../HANDOFF.md` section 2: a product for many users, each with a private vault; each user's own Anthropic API key, stored on the server in encrypted form and never sent back to a browser; an online vault in PostgreSQL plus an offline copy on each device. Parts A and B and the documentation check table are as first published, apart from one corrected sentence in A3 and the added A14. Part C is rewritten for many users and one stored key per user: C1 to C14 keep their numbers, C15 to C19 are new. The server has no Anthropic key of its own. No request was sent to the Anthropic API for either version, and for the revision no API key was looked for or used.

## Summary

- The Apple app calls Anthropic directly from the device with hand-written HTTP: `POST https://api.anthropic.com/v1/messages`, streaming, `max_tokens` 64000, header `anthropic-version: 2023-06-01`, key read from the Keychain. There are exactly two call sites: "Continue with Claude" (a chat appended to the session) and "Summarize" (overwrites the session summary).
- Every request carries the whole stored transcript. There is no truncation, token counting, prompt caching, retry, timeout handling or cancel. Only `stop_reason: "refusal"` is handled, and only in the chat.
- Checked against Anthropic's documentation on 2026-11-19: the app's five model ids still work but all are superseded. Current ids are `claude-opus-5-5` (the documented default choice), `claude-fable-5-2`, `claude-sonnet-5-5` and `claude-haiku-5-5`. The beta header `server-side-fallback-2026-07-01` is still required for `fallbacks: "default"` and still valid. The current API version is `2026-10-21`. Models, authentication, API keys and the Models API were read again on 2026-11-20: nothing above changed, and the rules for keys that Part C now needs are recorded after the check table.
- Users and keys: the web app is for many users, each with a private vault. Each user enters their own Anthropic API key once. The server checks it with Anthropic, stores it encrypted (AES-256-GCM under a master key that lives in the platform's secret store and never in the database), uses it only for that user's requests and never sends it back: afterwards the app shows only whether a key is stored, its last four characters and its status. The user can replace or remove it at any time; removing it stops that user's running requests at once. The server holds no Anthropic key of its own and nobody but the user pays for the user's requests (C15).
- The browser never calls Anthropic. A Node server uses `@anthropic-ai/sdk` 1.x with a client built for one request from the signed-in user's key, builds prompts from the stored session with a pure TypeScript module, and relays the reply to the browser as server-sent events on a POST response.
- Model choice is the user's (C16). A server-side registry of the four current models is the list every user starts with. A user may add any other model id that their own key can use; the server learns what a key can use from Anthropic's Models API. An id outside the registry gets no fallback opt-in and conservative limits.
- No preset questions and no forced output formats (C17): the user's text is sent as typed, and nothing is added to it. Summarize is the one fixed prompt, and it runs only when the user presses it. Every message and every reply can be copied whole (C18).
- The web app adds what the Apple app lacks: a pre-flight token count with a confirmation threshold, prompt caching, a rule for every stop reason, stable error codes, a Stop action, one turn at a time per session, and tests against a scripted fake upstream. The money is each user's own, so the guards are split (C9): limits per user, limits for the whole server, and a list of what protects the server itself.
- Vault and devices: the online vault is the source of truth. A turn commits the user's message and the reply together, in one write transaction; the user's other devices receive them through the change feed of sync.md. Nothing of a running turn and nothing of a key is ever in the offline copy, and Claude needs a connection (C19).
- Scale check: a 1,000,000-character session is roughly 400,000 tokens. It fits the 1,000,000-token context window of all four current models. On `claude-opus-5-5` it costs the user about 1.60 USD of input per uncached message and about 0.08 USD per message when read from the prompt cache.

## Conventions

- Part A is what the Apple app does today. Part B lists defects and accidents the web app must not copy. Part C is what the web app must do. The section between B and C records the check against current documentation.
- C15 to C19 were added on 2026-11-20. They stand between C12 and C13, so that the alternatives (C13) and the owner's decisions (C14) stay last; in that stretch the numbers are not in page order. Where the decisions replaced an idea of the first version, the old text is marked "superseded" with a pointer; no numbered section, defect or test script was renumbered or removed.
- Words: "the owner" is the person who owns this product (`../HANDOFF.md`). A "user" is anyone with an account. `owner_id` on a row is the id of the user the row belongs to (data-model.md section 1). "The user's key" is that user's own Anthropic API key.
- File references are relative to the repository root, for example `apple/SessionVault/ClaudeAPI.swift:56`. Below, `ClaudeAPI.swift`, `ContinueChatView.swift`, `SessionDetailView.swift`, `ContextPack.swift` and `Models.swift` are short for the files under `apple/SessionVault/` and `apple/SessionVault/Views/`.
- Strings quoted from the source that contain non-ASCII characters are written with JavaScript escapes: `\u2014` is an em dash, `\u2026` is an ellipsis. Everything else is literal.
- "(inference)" marks a statement that neither the code nor the documentation shows directly.
- "The docs" means the official Anthropic documentation on platform.claude.com and the `@anthropic-ai/sdk` repository at version 1.11.0, both read on 2026-11-19. Sources are listed at the end. The pages on models, authentication, API keys, the Models API, errors, rate limits, refusals, prompt caching, API versions and the TypeScript SDK were read again on 2026-11-20; "Re-check on 2026-11-20" below says what that added.
- No request was sent to the Anthropic API for this document, and the Apple app was not run. The prompt assembly in Part A was verified by compiling the relevant function bodies with `swiftc` and running them on synthetic data. The pure rules of Part C (C3 prompt assembly, the C5 turn rules as an in-memory model, C7 outcomes, the C8 mapping order, the C9 pre-flight and the browser stream parser) were written as plain JavaScript and run against the examples in this document. The SDK calls in C4 are a sketch that was not compiled.
- Revision of 2026-11-20: again no request to the Anthropic API, no API key looked for or used, the Apple app not run, no SQL executed. Run for the revision, on synthetic data: the test vector of C15.3 (computed with Apple CryptoKit and reproduced by an independent implementation written from the AES and GCM definitions); and, as plain JavaScript in JavaScriptCore, the key format check and the redaction rule of C15, the model rules of C16, the send table of C5 and the limit arithmetic of C9, each against the examples given for it. Every `file:line` reference of Parts A and B was read again in the source at commit `e81828a`.
- Names: routes and the `clientTurnId` field follow web-platform.md section 9 and 13.4; tables and columns follow data-model.md 7.2 as revised on 2026-11-20; the change feed, the mutations and the device rules are sync.md's. The turn table, the stream events, the error codes and the configuration variables are introduced here. The fields this document adds around a row keep the camelCase names of its first version (`clientTurnId`, `stopReason`, `retryAfterSeconds`), which web-platform.md and design.md cite; a session or message row inside them has exactly the snake_case shape of sync.md 4.3 and 5.2. Where this document and web-platform.md differ on the Claude flow, the difference is stated in C5 and this document governs (`../HANDOFF.md` section 5).

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

The list is a constant in client code (`ClaudeAPI.swift:8-14`); the fallback list is a second constant (`:24-26`). The picker order is the order above. The chosen model is view state: it resets to the default each time the sheet opens and is not stored (`ContinueChatView.swift:14`). `apple/README.md:16` names the same five models.

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

### A14. Copying a message in the Continue sheet (since commit e81828a)

Added on 2026-11-20; A1 to A13 are as first published.

- Stored messages in the Continue sheet are drawn by `MessageBubble` (`ContinueChatView.swift:114-116`), the view the detail screen also uses. Since commit `e81828a` every such bubble has a Copy button beside its role label. It puts `message.text` on the pasteboard unchanged, code fences included, and reads `Copied` for 1.5 seconds (`apple/SessionVault/Views/MessageView.swift:33-41`, `:60-66`). Before that commit only code blocks had a Copy button (`:173-178`, `:196-202`).
- The reply that is still streaming is a separate view without a Copy button; its text can only be selected (`ContinueChatView.swift:165-177`). The bubble that replaces it when the reply is stored has the button.
- Read in the source. The commit message says the app built for macOS and the iOS simulator and that the button was not clicked in a running app.
- Web rules: data-model.md 7.14 for stored messages, C18 for replies.

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

Added on 2026-11-20: the table is as first published. One cell of its last column is overtaken by the decisions of `../HANDOFF.md` section 2. B11 says "The key is a server secret"; there is no server key any more. Each user saves their own key and can check, replace and remove it, which is what B11 found missing in the Apple app (C15). The settings screen still never shows a key.

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

### Re-check on 2026-11-20 (models, authentication, API keys, Models API)

The table above is as first published; where its last column speaks of one list of models or of setup notes for one key, C15 and C16 now say more. These topics were read again on 2026-11-20, because Part C now stores one key per user and lets users choose models. Quoted text is from the documentation; nothing was tested against the API. Unchanged since 2026-11-19: the four current model ids with their windows and prices ("start with Claude Opus 5.5 for most workloads"), the `Authorization: Bearer` header with `x-api-key` as its legacy form, and 1.11.0 as the latest TypeScript SDK.

| Topic | Documentation on 2026-11-20 | Consequence for the web app |
|---|---|---|
| Form of a key | The Console shows a key "which starts with `sk-ant-`" once, at creation. The documented examples of API keys start with `sk-ant-api`. Admin API keys of a Claude Console organisation start with `sk-ant-admin01-` and manage the organisation. A scoped key of a Claude Enterprise organisation starts with `sk-ant-api01-` and "works only with the APIs your scopes cover". | C15.2: only a value that starts with `sk-ant-api` is accepted; `sk-ant-admin` is refused before anything is sent or stored. |
| Key types and workspaces | Personal keys, service account keys and (legacy) workspace keys. A key is created either for one workspace or for several. A key that is not scoped to one workspace needs the header `anthropic-workspace-id` on every request; without it the API answers 400 `invalid_request_error` ("This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header ..."). The Admin API accepts a personal or service account key "only if the key isn't scoped to a specific workspace". | C15.2: the server never sends `anthropic-workspace-id`, so only a key made for one workspace passes the check. That is intended: such a key cannot reach the Admin API. |
| Expiry, disabling | An expiry (3 hours to never) is chosen when a key is created and cannot be changed. An expired key answers `401 authentication_error`. Disable is reversible; Delete is permanent. | A stored key can stop working at any time and can start working again: status `rejected`, "check again", "replace" (C15.5). |
| IP allowlist (beta) | An organisation can restrict the covered endpoints, Messages and Models among them, to listed addresses. Other addresses get 403 `permission_error`: `Your IP address isn't in this organization's allowed range.` | Such a key cannot be used through this server: `key_unusable` on entry, `permission_denied` later (C8). |
| Credentials of an SDK client | Order: a constructor argument "Always overrides everything else"; then `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`; then the profile `ANTHROPIC_PROFILE` names; then the federation variables; then the active profile on disk (`~/.config/anthropic`, or `ANTHROPIC_CONFIG_DIR`). For TypeScript 1.x: "The one you pass is the only one. The client does not look for another in the environment or on disk", but `null` and `undefined` do not count as passed. "A variable that is set to an empty string can occupy its slot". A per-request `X-Api-Key` header "no longer replaces the client's key: both keys go out". | C15.7: one client per request, built with an explicit, non-empty `apiKey`; no credential variable in the published app; no authentication header in request options. |
| SDK logging | The level comes from `ANTHROPIC_LOG` or from the `logLevel` option, which overrides it. At `debug`, "all HTTP requests and responses are logged, including headers and bodies. Some authentication-related headers are redacted". | C15.7: `logLevel: "off"` in code. |
| Other things the SDK takes from the environment | From the doc comments on `ClientOptions` and the constructor in `src/client.ts` of the SDK: `baseURL` "Defaults to process.env['ANTHROPIC_BASE_URL']"; with a registered tracer provider "Each API call emits a span", unless `openTelemetry` is `false`, and `ANTHROPIC_OPEN_TELEMETRY_TRACES_CONTENT_MODE` sets what a span carries; each line of `ANTHROPIC_CUSTOM_HEADERS` becomes a default header of every client. | C4 and C15.7: `baseURL` and `openTelemetry: false` in code; no variable named `ANTHROPIC_...` in the published app. |
| Models API | `GET /v1/models`: "List available models", usable "to determine which models are available for use in the API", newest first. Query: `limit` (default 20, 1 to 1000), `after_id`, `before_id`, `lifecycle` (`active`, `deprecated`, `retired`; when omitted, active and deprecated). Each model: `id`, `display_name`, `created_at`, `lifecycle`, `deprecated_at`, `retires_at`, `line` (`haiku`, `sonnet`, `opus`, `fable`, `mythos` or null; "do not infer a line from the `id`"), `max_input_tokens` and `max_tokens` (a number or null), `capabilities`. Paging: `has_more`, `first_id`, `last_id`. Codes in `error.details.error_code`: `organization_on_hold` and `claude_code_key_creator_not_member`, both 400. `GET /v1/models/{model_id}` returns one model. The non-beta methods take no `betas`. | C16: this is how the server learns what a user's key can use. |
| Calling from a browser | "Call the Claude API from your own back end, not from code that runs in your users' browsers." A direct call needs `anthropic-dangerous-direct-browser-access: true`; organisations with zero data retention or the Compliance API, and some other settings, are refused even then, with a 401 that begins `CORS requests are not allowed for this Organization`. The check looks at the `Origin` header: "If your back end forwards requests that start in a browser, have it create a new request to the Claude API. Don't pass the browser's request through." | Server only. The server never copies a header of the browser's request into the request to Anthropic (C15.7). |
| Rate limits and spend caps | Per organisation and usage tier. New organisations "may start in the Evaluation tier, with limits below the standard limits". Monthly spend caps: Start 500 USD, Build 1,000 USD, Scale 200,000 USD. | Each user's limits are those of the organisation behind their key (C9). |
| Prompt cache | "Different organizations never share caches"; on the Claude API caches are also separate per workspace. Caching "is supported on all active Claude models"; the minimum cacheable prompt is 512 tokens on the four current models and 1,024 to 4,096 on older ones. | Nothing is cached across users (C10). |
| Linked billing (beta since 2026-11-17) | A user links their Claude organisation to an app through OAuth and is billed for the requests the app marks with `billing_policy`; those requests run in the app's own organisation, under its limits and its data retention. "It might not be suitable for production use." Organisations billed through a cloud marketplace, or with only a subscription plan, cannot be billed this way. | Not used. It would replace stored keys; see C12. |

## Part C: what the web app must do

Revised on 2026-11-20 for many users and for one stored key per user. C1 to C14 keep their numbers and headings and are rewritten where the decisions change them. C15 to C19 are new: C15 the user's API key, C16 model choice, C17 no preset questions and no forced formats, C18 copying, C19 many users and several devices.

### C1. Principles

1. A user's Anthropic key exists only on the server, in encrypted form (C15). No endpoint returns it and no log line contains it. The server has no Anthropic key of its own; the server secret `ANTHROPIC_API_KEY` of the first version is gone (C13). In a Vite project nothing secret gets a `VITE_` prefix: such variables are compiled into the browser bundle.
2. The browser sends only a session id, the new text, a model id and flags. The server loads the transcript from Postgres, for the signed-in user only, and builds the prompt. The client therefore cannot inject history, and request bodies stay small.
3. Prompt assembly is a pure TypeScript module in the shared package (no DOM, no Node), tested against the golden data in A13.
4. One server function performs every upstream call, so limits, caching, fallbacks and error mapping exist once. It gets its SDK client from the key service of C15 and from nowhere else.
5. A chat turn is written to the session only when there is a reply worth keeping (C5, C7).
6. Model ids, limits and beta names are server configuration. Which models a user sees is that user's choice (C16). The client renders what `GET /api/claude/config` returns.
7. Every request to Anthropic uses the signed-in user's own API key, and that user pays for it (`../HANDOFF.md` section 2). Never a key of the owner or of another user, never the hosting platform's managed AI integration, never an OpenAI-compatible layer: this contract needs the Anthropic Messages API with the `fallbacks` beta, top-level `cache_control`, `count_tokens` and the current model ids. The hosting platform's managed integration lists only older Claude ids (web-platform.md 10.10).
8. Every Claude route acts for the user of the sign-in session and reads and writes that user's rows only. Another user's session answers `404 not_found`, exactly like a session that does not exist (C19).
9. Nothing rewrites the user's question, and no reply format is imposed (C17).
10. Every message and every reply can be copied whole, as stored (C18).

Items 8 to 10 are new; items 1, 4, 6 and 7 were reworded for the stored key per user.

### C2. Server configuration

Names are proposals; defaults in the last column. "Secret" means: only in the platform's secret store, never in a file, in `.replit` or in the repository.

| Variable | Meaning | Default |
|---|---|---|
| `USER_KEY_ENC_KEY_V<n>` | Secret. Master key number n, which encrypts the users' API keys: 32 random bytes, base64 (C15, data-model.md 7.8). | none |
| `USER_KEY_ENC_VERSION` | The master key that encrypts new and replaced keys. | `1` |
| `ANTHROPIC_API_KEY` | Superseded: there is no server key. Neither this nor any other variable named `ANTHROPIC_...` may exist in the published app (C15.7). | must be unset |
| `CLAUDE_DEFAULT_MODEL` | Default model of a user who has not chosen one | `claude-opus-5-5` |
| `CLAUDE_SUMMARIZE_MODEL` | Superseded: Summarize uses the model the request names, otherwise the user's default model (C16). | not used |
| `CLAUDE_MODELS_JSON` | Optional replacement for the built-in registry below | unset |
| `CLAUDE_MAX_OUTPUT_TOKENS` | `max_tokens`, clamped to the model's maximum | `64000` |
| `CLAUDE_CACHE_TTL` | `1h`, `5m` or `off`, for chat requests of a user who has not chosen (C10) | `1h` |
| `CLAUDE_SERVER_SIDE_FALLBACKS` | `on` or `off`: a switch for the whole server, over the per-model flag and over the user's own switch | `on` |
| `CLAUDE_FALLBACK_BETA` | Beta header value | `server-side-fallback-2026-07-01` |
| `CLAUDE_CONFIRM_ABOVE_INPUT_TOKENS` | Ask the user before sending more than this | `100000` |
| `CLAUDE_MAX_INPUT_TOKENS` | Optional hard cap below the model window | unset |
| `CLAUDE_MAX_USER_TEXT_CHARS` | Longest new message | `200000` |
| `CLAUDE_MAX_PROMPT_BYTES` | New. Largest transcript, in UTF-8 bytes of message text, that the server loads for a turn (C9) | `16777216` |
| `CLAUDE_REQUEST_DEADLINE_MS` | Wall-clock limit for one turn | `1200000` (20 minutes) |
| `CLAUDE_MAX_CONCURRENT_TURNS` | Turns in flight for one user, across sessions | `2` |
| `CLAUDE_MAX_TURNS_PER_10_MIN` | Turn attempts of one user in 10 minutes | `30` |
| `CLAUDE_MAX_TURNS_PER_DAY` | Turn attempts of one user in a UTC day | `300` |
| `CLAUDE_MAX_ATTEMPTS_PER_TURN` | New. How often one `clientTurnId` may be tried | `5` |
| `CLAUDE_MAX_RUNNING_TURNS_GLOBAL` | New. Turns in flight on the whole server | `20` |
| `CLAUDE_MAX_TURNS_PER_MIN_GLOBAL` | New. Turn attempts per minute on the whole server | `60` |
| `CLAUDE_MAX_KEY_CHECKS_PER_HOUR` | New. Key saves and key checks of one user per hour | `10` |
| `CLAUDE_MAX_KEY_CHECKS_PER_HOUR_GLOBAL` | New. The same for the whole server | `120` |
| `CLAUDE_MAX_MODEL_LOOKUPS_PER_HOUR` | New. Model id checks of one user per hour (C16) | `30` |
| `CLAUDE_MAX_USER_MODELS` | New. Most model ids a user may add to the registry's list (C16) | `20` |

Storage limits (`VAULT_MAX_STORED_BYTES` and the others) are data-model.md 7.10. The numeric defaults are recommendations of this document (inference), not values from the Apple app, which has none.

Model registry. Built-in default; ids, windows and prices as read on 2026-11-19 and again on 2026-11-20:

```ts
export interface ClaudeModelConfig {
  id: string;                 // exact API id; never add a date suffix
  name: string;               // shown in the picker
  contextWindow: number;      // input tokens; used when the Models API gives no value
  maxOutputTokens: number;    // upper bound for max_tokens
  serverSideFallbacks: boolean;
  priceClass: "lowest" | "low" | "medium" | "high";   // shown beside the name; ordered by input price
  effort?: "low" | "medium" | "high" | "xhigh" | "max"; // omit = model default
  // Optional, only for cost estimates shown to the user. USD per million tokens.
  pricing?: { input: number; output: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number;
              above?: { promptTokens: number; input: number; output: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number } };
}

export const DEFAULT_CLAUDE_MODELS: ClaudeModelConfig[] = [
  { id: "claude-opus-5-5",   name: "Claude Opus 5.5",   contextWindow: 1_000_000, maxOutputTokens: 128_000, serverSideFallbacks: true,  priceClass: "medium",
    pricing: { input: 4, output: 20, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.20 } },
  { id: "claude-fable-5-2",  name: "Claude Fable 5.2",  contextWindow: 1_000_000, maxOutputTokens: 128_000, serverSideFallbacks: true,  priceClass: "high",
    pricing: { input: 8, output: 40, cacheWrite5m: 10, cacheWrite1h: 16, cacheRead: 0.20 } },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", contextWindow: 1_000_000, maxOutputTokens: 128_000, serverSideFallbacks: true,  priceClass: "low",
    pricing: { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.10 } },
  { id: "claude-haiku-5-5",  name: "Claude Haiku 5.5",  contextWindow: 1_000_000, maxOutputTokens: 128_000, serverSideFallbacks: false, priceClass: "lowest",
    pricing: { input: 0.10, output: 0.50, cacheWrite5m: 0.125, cacheWrite1h: 0.20, cacheRead: 0.01,
               above: { promptTokens: 100_000, input: 0.50, output: 2.50, cacheWrite5m: 0.625, cacheWrite1h: 1, cacheRead: 0.05 } } },
];
```

Rules:

- The registry is the list every user is offered, and the only source of fallback flags, effort settings, price classes and prices. It holds the current ids, not the Apple app's list. A model id that is not in it is "outside the registry"; C16 says how a user adds such an id and how it is used.
- The client never contains a model id. It may remember the last picked id in local storage and must fall back to `defaultModel` when that id is no longer offered.
- Superseded: the hourly refresh of the registry with the server's key. The server has no key. What a key can use is learned per user, with that user's key (C16).
- Superseded: key validation "with the server key". A key is checked when its user saves it (C15.2). `keyStatus` is now per user and is the column `user_api_keys.status`: `ok`, `rejected` or `unknown`. The settings screen shows this status and never the key.
- Prices are for estimates only and go stale. Show them as approximate. The money is the user's.

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

Added on 2026-11-20:

- Roles are an open list (data-model.md 6.2). A role of a structured transcript, such as tool output or a subagent's message, maps to `user` like every role other than `assistant`. Segments that are not text add nothing to `messages.text` (data-model.md 6.3) and are therefore not sent. How tool calls and tool results are rendered into a prompt is not decided here: decide it together with the context pack once the structured transcript format of `../HANDOFF.md` section 5 is documented. Do not invent a rendering.
- The module puts no question of its own into a request and asks for no reply format. C17 checks every string of it against that rule.

### C4. The upstream request

| Field | Web app value |
|---|---|
| `model` | The id the request names. It must be in the user's effective model list: a registry model, or an id that user added (C16). Anything else is `validation`. |
| `max_tokens` | `min(CLAUDE_MAX_OUTPUT_TOKENS, the model's maximum output)`; C16 says where that maximum comes from for an id outside the registry. |
| `system` | `CONTINUE_SYSTEM_PROMPT_V1` or `SUMMARIZE_SYSTEM_PROMPT_V1`, exactly as in A4. No date, title or other variable text. |
| `messages` | Chat: `buildContinueMessages(...)`. Summarize: one user message whose single text block is `buildSummarizeTranscript(...)`. |
| `cache_control` | Chat: `{type: "ephemeral", ttl: "1h"}` at the top level (the user's cache setting, otherwise `CLAUDE_CACHE_TTL`; omit when `off`; C10). Summarize: omit. |
| `fallbacks` and `betas` | When the model is in the registry with the flag, the server-wide switch is on and the user has not switched fallbacks off (C16): `fallbacks: "default"`, `betas: [CLAUDE_FALLBACK_BETA]`. Otherwise omit both. Always omitted for an id outside the registry. |
| `output_config` | Only `{effort}` when the registry sets one. Never `output_config.format`. |
| `thinking`, `temperature`, `top_p`, `top_k`, `tools`, `tool_choice`, `stop_sequences`, an assistant message at the end | Never sent |

Sketch (not compiled; method, option and event names are from the SDK source at 1.11.0 and from the SDK page):

```ts
import Anthropic from "@anthropic-ai/sdk";

// Inside the key service (C15): the only place where a client is built.
function clientFor(userKey: string): Anthropic {
  if (typeof userKey !== "string" || userKey.length === 0) throw new Error("no key"); // never let the SDK look in the environment
  return new Anthropic({
    apiKey: userKey,                        // the one credential; the SDK then looks nowhere else
    baseURL: "https://api.anthropic.com",   // fixed in code; shuts out ANTHROPIC_BASE_URL
    logLevel: "off",                        // shuts out ANTHROPIC_LOG
    openTelemetry: false,                   // no SDK spans, so no prompt text in a trace
  });                                       // defaults: maxRetries 2, timeout 10 min
}

// Inside keys.withClient(ownerId, async (client) => { ... }): one client for one user's one turn.
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
- New on 2026-11-20: a client holds one credential. With `apiKey` passed, the SDK uses that and looks nowhere else; with `undefined` or `null` it falls back to the environment and to profiles on disk, which is why `clientFor` refuses an empty value. A client object serves one user's one request: never cache, pool or share it. Never put an authentication header into a request's options: since SDK 1.0 a per-request `X-Api-Key` does not replace the client's key, both go out.
- New on 2026-11-20, from the doc comments on `ClientOptions` and the constructor in the SDK's `src/client.ts`: `baseURL` defaults to the variable `ANTHROPIC_BASE_URL`, `logLevel` to `ANTHROPIC_LOG`; the SDK emits an OpenTelemetry span for each call when the application has registered a tracer provider, and `openTelemetry: false` switches that off; and the variable `ANTHROPIC_CUSTOM_HEADERS` adds headers to every request of every client, which no option switches off. Hence the four options in `clientFor`, and the rule in C15.7 that the published app has no variable whose name starts with `ANTHROPIC_`.

### C5. Turn lifecycle and persistence

A "turn" is one Claude request for one session: one chat exchange or one Summarize request. The browser gives each turn a random UUID, `clientTurnId`, the name web-platform.md 9.4 uses. web-platform.md asks that an in-flight or interrupted turn can be represented on the server; data-model.md 7.2 has no table for that, so this document defines one. It follows the rules that data-model.md 7.7 sets for the tables of other documents: `owner_id` first in every key, a composite reference to the session, and no extension, trigger, function, procedure or domain.

```sql
CREATE TABLE claude_turns (
  owner_id              uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  id                    uuid NOT NULL,                 -- the browser's clientTurnId; unique per user, not across users
  session_id            uuid NOT NULL,
  kind                  text NOT NULL,                 -- 'continue' | 'summarize'
  status                text NOT NULL,                 -- 'running' | 'saved' | 'truncated' | 'refused' | 'empty'
                                                       -- | 'cancelled' | 'failed' | 'interrupted' | 'discarded'
  persisted             boolean NOT NULL DEFAULT false, -- messages or the summary were written
  attempts              integer NOT NULL DEFAULT 1,
  requested_model       text NOT NULL,
  served_model          text NOT NULL DEFAULT '',
  seen_messages_rev     integer NOT NULL,              -- sessions.messages_rev when the turn started
  user_text             text NOT NULL DEFAULT '',      -- chat: the user's text until it becomes a message
  draft_text            text NOT NULL DEFAULT '',      -- Summarize: an unsaved draft (C7)
  stop_reason           text NOT NULL DEFAULT '',
  refusal               jsonb,                         -- {category, explanation, recommendedModel}
  error_code            text NOT NULL DEFAULT '',
  error_message         text NOT NULL DEFAULT '',      -- upstream text after redaction (C15.6); can quote input
  upstream_request_id   text NOT NULL DEFAULT '',
  preflight_input_tokens integer,
  usage                 jsonb,                         -- final usage object, including iterations
  cancel_requested      boolean NOT NULL DEFAULT false,
  user_message_id       uuid,                          -- rows written by this turn
  assistant_message_id  uuid,
  started_at            timestamptz NOT NULL DEFAULT now(),
  heartbeat_at          timestamptz NOT NULL DEFAULT now(),  -- refreshed while running
  finished_at           timestamptz,
  PRIMARY KEY (owner_id, id),
  CONSTRAINT claude_turns_session_fkey FOREIGN KEY (owner_id, session_id)
      REFERENCES sessions (owner_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX claude_turns_one_running_per_session ON claude_turns (owner_id, session_id) WHERE status = 'running';
CREATE INDEX claude_turns_owner_started_idx ON claude_turns (owner_id, started_at);
CREATE INDEX claude_turns_started_idx ON claude_turns (started_at);   -- the server-wide rate of C9
```

Changed against the first version: `owners` is `users`; the key is `(owner_id, id)`; the session reference and the one-running-turn index start with `owner_id`; `seen_messages_rev` and the status `discarded` are new; a second index serves the server-wide rate.

- The key `(owner_id, id)` scopes a `clientTurnId` to its user. Two users may send the same id and get two unrelated rows. With the single-column key of the first version, a second user who sent an id that was already in use would have received `turn_in_progress`, or a replay of another user's `done` event.
- The partial unique index is the lock: a second running turn for the same session fails on insert. If the hosting platform's schema tooling cannot keep a partial index (check 4 in web-platform.md 13.1), take the session row `FOR UPDATE` and test for a running row inside one transaction.
- The table is also the limiter state (C9), the usage record, and the place where the user's text lives until there is a reply. `user_text`, `draft_text` and `error_message` are transcript text or can quote it: treat them like `messages.text` for encryption and logging.
- Text in this table is short-lived, because it does not count towards the storage quota. When a user starts a turn, the server cleans up for that user: the other unfinished turns of the same session are discarded, exactly as the discard route of C6 does (only the latest turn of a session can be retried); so are the user's unfinished turns older than a day; and finished rows older than 30 days are deleted.
- "Running" means, everywhere: status `running` and a `heartbeat_at` younger than 60 seconds. sync.md 6.5 refuses to delete a session while a turn is running for it; the delete handler uses this definition, so that a dead turn never blocks a delete.
- Deleting a session removes its turn rows (cascade). Account deletion removes them first of all (data-model.md 7.11, step 3).

Why the user's text is not inserted into `messages` first. This is one of the disagreements between documents that the first version of `../HANDOFF.md` section 5 listed, and it is settled in favour of this section. The first version of web-platform.md 9.4 said "the server stores the user message together with that id"; its revision follows this section. Here the text is stored in the turn row and becomes a message row in the same transaction as the reply. Every goal of that section still holds (one user message per `clientTurnId`, retry without duplication, state on the server), and the transcript never contains an unanswered or refused user message, which is defect B5. With several devices it matters more than before: a message row that is committed is delivered to every device by the change feed, and nothing takes it back.

What a `POST` with a given `clientTurnId` does (the idempotent send of web-platform.md 9.4). The row is looked up by `(owner_id, id)`, so only the sender's own turns can match:

| Row for this id | Action |
|---|---|
| none | Start a new turn. |
| belongs to another session, or has the other `kind` | `400 validation`. |
| running | `409 turn_in_progress`. |
| status `running` with a stale heartbeat | Set it to `interrupted`, then go on as for a finished row. |
| finished and `persisted` | Answer `200` with a stream that contains only `done`, rebuilt from the row, the stored messages and the present session row. Nothing is generated, and no key is needed. |
| `discarded` | `400 validation`. A discarded turn is never sent again; a new message gets a new id. |
| finished, not `persisted`, `attempts` below `CLAUDE_MAX_ATTEMPTS_PER_TURN` | Retry: set the row back to `running`, add 1 to `attempts`, set `started_at` and `heartbeat_at` to now, clear the error fields and `cancel_requested`, keep `user_text` from the row (the body's `text` is ignored), take `model` and the flags from the body. |
| finished, not `persisted`, `attempts` at the limit | `429 app_rate_limited`. The client may send the same text as a new turn with a new id. |

Chat turn, in order. Everything up to step 8 answers with JSON; from step 9 on the answer is a stream.

1. User and body. Take the user id from the sign-in session and from nowhere else (data-model.md 7.7, rule 2). No sign-in session: `401 not_signed_in`. Account `suspended`: `403 account_suspended`. Validate the body (C6): `400 validation`.
2. Session. Read the session row with `WHERE owner_id = $1 AND id = $2`. No row: `404 not_found`. That is also the answer for another user's session (data-model.md 7.12, rule I4) and for a session that exists only on a device (sync.md section 11, item 4).
3. Turn id. Apply the table above. A replay ends here.
4. May this user start a turn now? In this order: no stored key: `409 not_configured`. Model not in the user's effective list (C16): `400 validation`. `users.stored_bytes` at or over the quota: `413 quota_exceeded` (data-model.md 7.10; checked here and never at the commit). `sessions.text_bytes` plus the bytes of the new text over `CLAUDE_MAX_PROMPT_BYTES`: `413 input_too_large`. A per-user limit: `429 app_rate_limited`. A server-wide limit: `503 server_busy` (C9).
5. Set a dead turn of this session, if there is one, to `interrupted`. Insert the turn row (or reset it) with status `running`, `user_text` and `seen_messages_rev`, and start the turn heartbeat described below. A unique violation on the partial index means `409 turn_in_progress`.
6. Get a client from the key service (C15.4). Everything upstream, from here to the end of the turn, runs inside `keys.withClient`. If the stored key cannot be decrypted: finish the row as `failed`, answer `503 key_unreadable`.
7. Load the transcript with the query of data-model.md 7.3. Build the messages (C3) from the stored messages and `user_text`. Run the pre-flight size check (C9). If it rejects, finish the row as `failed` with that code, answer with JSON and stop. The row is kept, not deleted as in the first version: it holds the user's text for the repeat with `confirmLargeInput`, and it counts for the limits.
8. If `cancel_requested` is already set, finish as cancelled.
9. Open the SSE response and send `start`. Start the `: ping` timer and the deadline timer.
10. Call upstream (C4). Forward each text delta. Keep the accumulated text in memory.
11. When the upstream call ends, classify the outcome (C7). When the outcome says "commit", run the commit below. Otherwise only update the turn row.
12. Send `done` or `error` and end the response.

The commit of a chat turn is one write transaction of data-model.md 7.9, at `READ COMMITTED`:

1. `SELECT change_seq, session_count, stored_bytes FROM users WHERE id = $1 AND status = 'active' FOR NO KEY UPDATE`. No row: roll back; the turn ends as `failed` with `account_suspended`.
2. `SELECT messages_rev, model, provider FROM sessions WHERE owner_id = $1 AND id = $2 FOR UPDATE`. No row: roll back, `failed` with `not_found`. `messages_rev` is not the turn's `seen_messages_rev`: roll back, `failed` with `session_changed`; the transcript was replaced while the turn ran, and the reply would answer messages that are gone.
3. Insert the user message and then the assistant message at the next two positions, with the append statement of data-model.md 7.3. The server makes both ids. `created_at` is the commit time on both.
4. Update the session: `message_count` plus 2, `text_bytes`, `stored_bytes` (data-model.md 7.10), `updated_at = now()`, `seq = change_seq + 1`, and `model` under the rule at the end of this section. The whole turn takes one number.
5. Update `users`: `change_seq` plus 1, and `stored_bytes` by the same difference.
6. Update the turn row: status, `persisted = true`, the two message ids, `served_model`, `stop_reason`, `usage`, `finished_at`; empty `user_text`, which now lives in `messages`.

No storage quota is checked in the commit: a reply that was generated is always stored (data-model.md 7.10, rule 1). The new `seq` is what carries the two messages to the user's other devices (C19).

Rules that hold throughout:

- A dropped browser connection is not a stop. If writing to the response fails or the socket closes, continue steps 10 and 11 without writing. This reproduces the Apple behaviour (the reply is saved even when the sheet is closed) and matters on phones, where background tabs lose connections. Whether the hosting platform lets the process keep working after the response has ended, and how long one response may last, is unverified; see web-platform.md 9.2, 9.4 and checks 2 and 3 in its section 13.1. If work stops, the heartbeat stops and the turn becomes `interrupted`.
- Heartbeat and stale turns (web-platform.md 9.4 rule 2): while a turn runs, every 2 seconds execute `UPDATE claude_turns SET heartbeat_at = now() WHERE owner_id = $1 AND id = $2 RETURNING cancel_requested`. A row that has status `running` and a `heartbeat_at` older than 60 seconds belongs to a process that died. It counts as not running wherever it is read: the turn route reports it as `interrupted`, and the next turn, stop or discard for its session writes that status. (The first version let the turn route write it; a `GET` must not change state, web-platform.md 13.4.) The interface then shows the stored `user_text` with a Retry action, which sends the same `clientTurnId` again.
- Stop is explicit: `POST /api/sessions/:id/stop` sets `cancel_requested` on the session's running turn and, when that turn lives in this process, aborts the upstream stream at once. The heartbeat statement returns the flag, so Stop also works when another process received it.
- Removing the user's key stops all of that user's running turns in the same way (C15.5).
- When the deadline passes, abort upstream and finish with the error `upstream_timeout`.
- The SSE response is opened before the model call so that heartbeats flow while Anthropic processes a large prompt. Failures of the model call therefore reach the browser as `error` events, not as HTTP statuses. Only failures in steps 1 to 8 are JSON responses.
- More than one server process is allowed for. The lock, the limits, the stop flag and the stored key live in Postgres; only immediate aborts and `partialText` are per process. A stop or a key removal that reaches another process takes effect with the next heartbeat, within 2 seconds.
- Never write transcript text, upstream message text or a key to logs. Log the user id, turn id, session id, model, outcome, duration, token usage and the upstream request id. The SDK's own logging is switched off in code (C4).

Summarize turn: the same steps with `kind = 'summarize'` and no `user_text`. In step 4, after the key checks, an empty transcript is `nothing_to_summarize` and an existing summary without `replaceExisting` is `summary_exists`; a repeated send of a finished, persisted turn still replays `done`. The commit locks the user's counter and the session row as above and then, when the outcome says "save": reads the present `summary` as `previousSummary`; writes `summary`, `search_text` (`buildSearchText`, data-model.md 8.1), `stored_bytes`, `updated_at` and `seq = change_seq + 1`; and updates `users`. When the outcome is a truncated draft, only the turn row is written (`draft_text`). When `messages_rev` has changed, nothing is written to the session; the turn ends as `failed` with `session_changed`, and the generated text is kept in `draft_text`.

`previousSummary` is read under the row lock, so it is exactly the text that was replaced. If another device changed the summary while the turn ran, the turn still saves: the later write wins, as for any two writes to one field (sync.md section 7, case 2). The `done` event then carries a `previousSummary` that the user has not been asked about; the interface says that a summary was replaced and offers to restore it, which is an ordinary summary edit.

Stored fields this flow sets:

- `messages.model`: the model that answered (`final.model`), on the assistant message; empty on the user message.
- `messages.created_at`: the commit time, on both.
- `messages.extra`: for an incomplete assistant message, `{"x_claude": {"incomplete": "truncated" | "cancelled", "stop_reason": "<stop reason or empty>"}}`. The key is `x_claude`, not `claude` as in the first version, and its property names are in snake_case, so that the value travels in an interchange file as an extension property (data-model.md 7.6).
- `sessions.model`: set to the answering model only when it is empty and the session's provider is `claude`; otherwise it is left alone. This is another disagreement that the first version of `../HANDOFF.md` section 5 listed, settled in favour of this document: data-model.md first proposed "only when empty", which would still stamp a Claude model id on sessions from other providers, because no importer sets that label. data-model.md section 12, item 6 now records the same rule. web-platform.md 9.4, rule 4, now says the same.
- Text hygiene. Before it is stored or sent, the user's text gets the hygiene of every stored string (data-model.md 5.2, row C9, and 5.1, row B13): U+0000 is removed, a lone surrogate becomes U+FFFD, CR LF and a lone CR become LF. The reply gets the same before it is stored. Text typed into a browser field contains none of these, so in practice nothing changes.

### C6. HTTP contract between browser and server

All routes are same-origin and require a signed-in user; the cross-site and cookie rules are in web-platform.md 11, and every route that changes state gets the cross-site checks of its 11.3. The user is the one of the sign-in session: no route takes a user id from a path, a query string, a header or a body (data-model.md 7.7, rule 2). Paths follow web-platform.md 9.3 and 13.4. Errors before a stream starts are JSON: `{"error": {"code", "message", "retryable", "retryAfterSeconds", "details"}}` with the status from C8. The `postSse` helper in web-platform.md 9.3 throws on any status other than 200; extend it to read this JSON body first.

| Route | Purpose | Account `suspended` |
|---|---|---|
| `GET /api/claude/config` | The caller's key state, models, preferences and limits. Never calls Anthropic. | allowed |
| `PUT /api/claude/key` | Save or replace the caller's API key (C15.2) | `403` |
| `POST /api/claude/key/check` | Check the stored key again, and read its models again (C15.5, C16) | `403` |
| `DELETE /api/claude/key` | Remove the stored key (C15.5) | allowed |
| `GET /api/claude/models` | The models the caller's key can use, as last read (C16). Never calls Anthropic. | allowed |
| `PUT /api/claude/preferences` | The model ids the caller added, the default model and two switches (C16) | `403` |
| `POST /api/sessions/:id/continue` | Chat turn; answers with a stream | `403` |
| `POST /api/sessions/:id/summarize` | Summarize turn; answers with a stream | `403` |
| `POST /api/sessions/:id/stop` | Stop the session's running turn | allowed |
| `GET /api/sessions/:id/turn` | The session's latest turn | allowed |
| `DELETE /api/sessions/:id/turn` | Discard an unfinished turn and its text | allowed |

The five routes under `/api/claude/` other than `config`, and `DELETE /api/sessions/:id/turn`, are new; web-platform.md 13.4 has to list them. Every route with a session id answers `404 not_found` for a session that is not the caller's. No `GET` route changes state or calls Anthropic. Reading, removing a key, stopping and discarding stay possible for a suspended user: they only ever reduce what the account does.

`GET /api/claude/config`

```json
{
  "configured": true,
  "keyStatus": "ok",
  "key": {"last4": "1111", "savedAt": "2026-11-20T10:00:00.000Z", "checkedAt": "2026-11-20T10:00:00.000Z", "lastUsedAt": null},
  "defaultModel": "claude-opus-5-5",
  "summarizeModel": "claude-opus-5-5",
  "models": [
    {"id": "claude-opus-5-5", "name": "Claude Opus 5.5", "contextWindow": 1000000, "inRegistry": true, "priceClass": "medium", "available": true},
    {"id": "claude-fable-5-2", "name": "Claude Fable 5.2", "contextWindow": 1000000, "inRegistry": true, "priceClass": "high", "available": true},
    {"id": "claude-sonnet-5-5", "name": "Claude Sonnet 5.5", "contextWindow": 1000000, "inRegistry": true, "priceClass": "low", "available": true},
    {"id": "claude-haiku-5-5", "name": "Claude Haiku 5.5", "contextWindow": 1000000, "inRegistry": true, "priceClass": "lowest", "available": true}
  ],
  "preferences": {"models": [], "defaultModel": null, "fallbacks": null, "cacheTtl": null},
  "serverDefaults": {"fallbacks": true, "cacheTtl": "1h"},
  "limits": {"confirmAboveInputTokens": 100000, "maxUserTextChars": 200000}
}
```

- Everything in this answer is the caller's own. `configured` is true when the caller has a stored key; then `keyStatus` is `ok`, `rejected` or `unknown` (C15.5) and `key` holds what may be shown: the last four characters and three times. Without a key, `keyStatus` and `key` are null and the client replaces the chat composer and the Summarize action with a notice (C8, `not_configured`). The key itself is in no answer of any route.
- `models` is the caller's effective list (C16) without the entries that the key is known not to have. `available` is true, or null when the key's models have not been read since this server process started. `defaultModel` and `summarizeModel` are ids from that list, or null when it is empty.
- `preferences` is what the user chose: `models` are the ids the user added to the registry's list; null elsewhere means "not chosen", and then `CLAUDE_DEFAULT_MODEL` and `serverDefaults` apply.
- The route reads the database and process memory only. It makes no upstream call, so that opening the app never waits for Anthropic.

`PUT /api/claude/key`

```json
{"key": "sk-ant-api03-EXAMPLE-not-a-real-key-AAAA1111"}
```

Saves or replaces the caller's key after the checks of C15.2. Success is `200 {"status": "ok", "last4": "1111"}`, or `"status": "unknown"` when Anthropic could not be asked: the status and the last four characters and nothing else (data-model.md 7.8). Body limit 2 kB. The body of this route is never logged, the key is never put into a URL, and the request is never queued for later sending (sync.md section 10, item 2). Errors: `validation` with `details.reason` (`empty`, `too_long`, `bad_characters`, `not_an_api_key`, `admin_key`), `key_rejected`, `key_unusable`, `key_service_unavailable`, `app_rate_limited`, `server_busy`.

`POST /api/claude/key/check` has no body. It asks Anthropic about the stored key with the Models call of C15.2, which also renews what the process knows about the key's models. It answers `200 {"status", "last4", "checkedAt", "checked"}`; `checked` is false when Anthropic could not be asked, and then the status is unchanged. `409 not_configured` without a stored key. The settings use it for both "check again" and "refresh models".

`DELETE /api/claude/key` answers `200 {"configured": false}`, also when there was no key. It stops the caller's running turns (C15.5).

`GET /api/claude/models`

```json
{
  "checkedAt": "2026-11-20T10:00:00.000Z",
  "models": [
    {"id": "claude-opus-5-5", "name": "Claude Opus 5.5", "inRegistry": true, "priceClass": "medium", "contextWindow": 1000000,
     "maxOutputTokens": 128000, "lifecycle": "active", "line": "opus", "available": true, "inList": true},
    {"id": "example-model-1", "name": "Example Model 1", "inRegistry": false, "priceClass": "unknown", "contextWindow": 200000,
     "maxOutputTokens": 64000, "lifecycle": "deprecated", "line": null, "available": true, "inList": false}
  ]
}
```

Every registry model and every model that Anthropic listed for the caller's key, each once. `available` is false for a registry model the key does not have. `inList` says whether the model is in the caller's effective list: a registry model, or one the user added. The route answers from process memory and makes no upstream call. When the key's models have not been read since the process started, `checkedAt` is null, the list holds the registry and the ids the caller added, and every `available` is null; `POST /api/claude/key/check` reads them.

`PUT /api/claude/preferences`

```json
{"models": ["example-model-1"], "defaultModel": "claude-opus-5-5", "fallbacks": true, "cacheTtl": "1h"}
```

Every field is optional; a field that is left out stays as it is, and null means "back to the server default". `models` is the whole list of the ids the user added, not a change to it. C16 has the rules for `models` and `defaultModel`. Success is `200` with the body of `GET /api/claude/config`. The values are stored in `user_settings.data` (data-model.md 7.7, rule 5) under `claude_models`, `claude_model_info`, `claude_default_model`, `claude_fallbacks` and `claude_cache_ttl`. A release may ship without controls for the last two: the server defaults then apply.

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

`GET /api/sessions/:id/turn` changes nothing. It answers `{"turn": null}` or the session's latest turn: `{"turn": {"clientTurnId", "kind", "status", "persisted", "requestedModel", "servedModel", "startedAt", "finishedAt", "userText", "draftText", "partialText", "errorCode", "errorMessage", "refusal"}}`. A client that lost its stream polls this every 2 seconds while `status` is `running`, then reloads the session. `partialText` is the text so far when the turn lives in the answering process, else null. A latest turn that is `discarded` answers `{"turn": null}`; one whose process died is reported as `interrupted` (C5). This is also how a second device of the same user learns that a turn is running (C19).

`DELETE /api/sessions/:id/turn` discards the session's latest turn when it is finished, or dead, and not persisted: the row gets status `discarded`, and `user_text`, `draft_text`, `error_message` and `refusal` are emptied. Answer `200 {"discarded": true}`. A running turn: `409 turn_in_progress`. No turn, a persisted turn or an already discarded one: `200 {"discarded": false}`. The row stays, without text, for the limits and the usage record. The first version had the "Discard" action without a route, which was enough for one browser; with several devices the discard has to reach the server.

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
  "userMessage": {"id": "00000000-0000-4000-8000-00000000a008", "position": 8, "role": "user",
                  "text": "How often should I water mint?", "segments": null, "model": "",
                  "created_at": "2026-11-20T10:00:05.000Z", "extra": {}},
  "assistantMessage": {"id": "00000000-0000-4000-8000-00000000a009", "position": 9, "role": "assistant",
                       "text": "Water mint twice a week.", "segments": null, "model": "claude-opus-5-5",
                       "created_at": "2026-11-20T10:00:05.000Z", "extra": {}},
  "session": {"id": "00000000-0000-4000-8000-0000000000c1", "message_count": 10, "messages_rev": 1, "seq": 58},
  "summary": null,
  "previousSummary": null,
  "refusal": null,
  "usage": {"inputTokens": 12, "cacheCreationInputTokens": 1834, "cacheReadInputTokens": 0, "outputTokens": 215}
}
```

- `outcome` is one of `saved`, `truncated`, `refused`, `empty`, `cancelled` (C7).
- `userMessage` and `assistantMessage` are the committed rows, or null when nothing was committed. They have exactly the message shape of sync.md 5.2: snake_case, and the place of a message is `position`. The first version showed `index` here.
- `session` is the session row as the server holds it after the commit, in the shape of sync.md 4.3; the example is cut short. It is null when nothing was written to the session. The device applies it like a row from the change feed (C19).
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
- On opening a session, read the turn route: a `running` turn shows the stored `userText` as a pending message and polls; a turn that is `failed` or `interrupted` within the last day offers Retry and Discard. Discard calls `DELETE /api/sessions/:id/turn`. A `failed` turn whose `errorCode` is `confirmation_required` or `input_too_large` is not offered: the user has seen that answer already.
- Offer Continue and Summarize only when `configured` is true, the app has a connection, and the session is on the server (not a session whose create is still queued, and not a kept record; sync.md section 11, item 4). With `keyStatus` `rejected` they stay available and the interface warns before sending (design.md 4.6.7): a key that works again is found out by using it.
- After `done`, show and copy the texts from the event, not the text put together from the `delta` events (C18), and start a sync run (C19).
- Render deltas at most once per animation frame.
- The service worker must not handle `/api/` requests (web-platform.md).
- Claude actions are unavailable offline. A key cannot be entered, checked or removed offline either.

### C7. Outcome rules

`text` is the accumulated reply trimmed with `trim()`.

| Condition | Chat | Summarize |
|---|---|---|
| Stop reason `end_turn` or `stop_sequence`, or a value this table does not know, and `text` not empty | Commit the user and assistant messages. Outcome `saved`. | Save the summary. Outcome `saved`. |
| `max_tokens` or `model_context_window_exceeded`, `text` not empty | Commit both; mark the assistant message truncated. Outcome `truncated`, `persisted` true. The interface says the reply was cut off. It offers no ready-made follow-up: the user writes the next message (C17). | Do not save the summary. Store the text in the turn's `draft_text`. Outcome `truncated`, `persisted` false, draft in `summary`. The interface offers to keep the draft (an ordinary summary update) or discard it. |
| `refusal`, with or without text | Commit nothing; discard the text. Outcome `refused`. | Commit nothing. Outcome `refused`. |
| Any stop reason, `text` empty | Commit nothing. Outcome `empty`. | Commit nothing. Outcome `empty`. |
| Stopped by the user, `text` not empty | Commit both; mark the assistant message cancelled. Outcome `cancelled`, `persisted` true. | Do not save. Outcome `cancelled`, `persisted` false. |
| Stopped by the user, `text` empty | Commit nothing. Outcome `cancelled`, `persisted` false. | same |
| Upstream error, early end of stream, deadline | Commit nothing. `error` event. | same |

Evaluate in this order, first match wins: stopped by the user; no stop reason on the final message (error `stream_interrupted`); `refusal`; empty text; truncation; saved.

`tool_use`, `pause_turn` and `compaction` cannot occur because no tools or compaction are requested; if one appears, log it and treat it as an unknown value.

Changed on 2026-11-20: in the first version the interface offered to send `Please continue from where you left off.` after a truncated chat reply. That was a ready-made question and is gone (C17). A turn that is stopped because its user removed the key (C15.5) follows the two "Stopped by the user" rows.

Messages for the non-error outcomes:

| Outcome | Text |
|---|---|
| `refused` | `Claude declined this request.` followed by the API's explanation when present. With `recommendedModel`: `Try again with <model name>.` Do not resend automatically. |
| `empty` (chat) | `Claude returned no text (stop reason: <stopReason>). Nothing was saved.` |
| `empty` (Summarize) | `Claude returned no summary.` |
| `truncated` | `This reply was cut off by the length limit.` |
| `cancelled` | No message. A stopped reply is shown with the label `Stopped`. |

### C8. Error surface

Map every failure to one of these codes. The browser shows the fixed message; the upstream message and request id go into a details line. The status column applies when the failure happens before the stream opens (validation, app limits, pre-flight including the token count call); the same codes appear in `error` events afterwards. Upstream failures use status 502, 503 or 504, never 401, so the client cannot mistake a bad Anthropic key for an expired app login. Messages speak to the user whose key and whose account are meant; the first version spoke of "the server's" key.

| Code | When | HTTP status before the stream | Retryable | Message |
|---|---|---|---|---|
| `not_signed_in` | No valid sign-in session (web-platform.md 13.4) | 401 | no | None; the page shows sign-in and keeps unsent input. |
| `account_suspended` | The account is suspended (data-model.md 7.7) | 403 | no | `This account cannot use Claude at the moment.` |
| `not_found` | The session is not the caller's, or does not exist | 404 | no | `This session was not found.` |
| `not_configured` | The caller has no stored API key | 409 | no | `Add your Anthropic API key in Settings to use Claude.` |
| `validation` | Blank or too long text, a model that is not in the caller's list, malformed body, a turn id that belongs to another session or was discarded | 400 | no | Specific to the field |
| `quota_exceeded` | The caller's vault is at its storage limit (data-model.md 7.10) | 413 | no | Names the limit that was hit, as data-model.md 7.10 rule 3 asks. |
| `nothing_to_summarize` | The transcript is empty | 400 | no | `This session has no messages to summarize.` |
| `summary_exists` | Summary present and `replaceExisting` false | 409 | no | Client asks `Replace the existing summary?` |
| `turn_in_progress` | A turn is already running for the session, with this or another `clientTurnId` | 409 | no | `Claude is already working on this session.` The client polls the turn route. |
| `confirmation_required` | Input above the confirmation threshold | 409 | no | Client shows the size and estimate, then repeats the request with `confirmLargeInput: true`. `details`: `{"inputTokens", "estimated", "threshold", "model", "contextWindow", "estimatedInputCostUsd"}`; the estimate is null for a model without a price in the registry. |
| `input_too_large` | Transcript over `CLAUDE_MAX_PROMPT_BYTES`; pre-flight above the hard limit; upstream 400 whose message says the prompt is too long; upstream 413 | 413 | no | `This session is too long for <model name>: about <n> tokens, limit <m>.` Without a count: `This session is too long to send to Claude.` |
| `app_rate_limited` | A per-user limit of C9 | 429 | yes | `Too many Claude requests. Wait a moment and try again.` |
| `server_busy` | A server-wide limit of C9 | 503 | yes | `The server is busy. Try again in a moment.` |
| `key_unreadable` | The caller's stored key cannot be decrypted (C15.4) | 503 | no | `Your stored API key cannot be read. Enter it again in Settings.` |
| `key_service_unavailable` | The server cannot handle keys at all: no usable master key when a key is to be saved (C15.3), or a variable named `ANTHROPIC_...` in the published app's environment (C15.7) | 503 | no | `The server cannot handle API keys right now.` |
| `auth_failed` | Upstream 401 | 502 | no | `Anthropic rejected your API key. It may be wrong, disabled or expired. Replace it in Settings, or enable it again in the Claude Console.` |
| `billing` | Upstream 402 | 502 | no | `Anthropic reports a billing problem with your API account.` |
| `permission_denied` | Upstream 403 | 502 | no | `Your API key is not allowed to do this.` |
| `model_unavailable` | Upstream 404 | 502 | no | `The model <id> is not available to your API key.` |
| `spend_limit` | Upstream 429 with error code `enforced_spend_limit_reached` or `contract_spend_limit_reached` | 502 | no | `Your Anthropic account has reached its spend limit.` |
| `rate_limited` | Any other upstream 429 | 503 | yes | `Anthropic is limiting requests for your account. Try again in <n> seconds.` with `retry-after` when present |
| `overloaded` | Upstream 529, or type `overloaded_error` inside the stream | 503 | yes | `Claude is overloaded right now. Try again shortly.` |
| `upstream_timeout` | Upstream 504 or type `timeout_error`; SDK connection timeout; the turn deadline | 504 | yes | `The request to Claude timed out.` |
| `upstream_error` | Other upstream 5xx; type `api_error` | 502 | yes | `Anthropic had a server error. Try again.` |
| `network` | SDK connection error | 502 | yes | `The server could not reach Anthropic.` |
| `stream_interrupted` | The stream ended without a final message | 502 | yes | `The reply was interrupted before it finished.` |
| `upstream_rejected` | Any other upstream 400 | 502 | no | `Claude rejected the request.` plus the upstream message |
| `session_changed` | The session's messages were replaced while the turn ran (C5) | stream only | yes | `This session changed while Claude was answering. Nothing was saved.` |

New against the first version: `not_signed_in`, `account_suspended`, `not_found`, `quota_exceeded`, `server_busy`, `key_unreadable`, `key_service_unavailable`, `session_changed`. Changed: `not_configured` is now the state of one user, with status 409 where it was 503 for a server without a key; every message that named "the server's" key or account now says "your".

Codes of the key routes (C15) only:

| Code | When | HTTP status | Message |
|---|---|---|---|
| `validation` | A local check of C15.2 fails; `details.reason` says which | 400 | By reason; for `admin_key`: `This is an Admin API key. Create an ordinary API key for one workspace instead.` |
| `key_rejected` | Anthropic answered 401 to the check | 400 | `Anthropic did not accept this key. Nothing was saved.` |
| `key_unusable` | Anthropic answered 400 or 403 to the check | 400 | `This key cannot be used here.` plus the upstream message |

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
- A spend limit that the user set in the Claude Console arrives as a 400 with an explanatory message and no code; it lands in `upstream_rejected`.
- The Fable models require the organisation to keep data for 30 days. Without that, every request to them is a 400 with an explanatory message; it also lands in `upstream_rejected`. With one key per user this depends on each user's organisation.
- If the beta header is ever retired, every request to a model with the fallback flag fails with a 400 about an unexpected `anthropic-beta` value. Log this prominently; the fix is `CLAUDE_SERVER_SIDE_FALLBACKS=off` or a new `CLAUDE_FALLBACK_BETA`. Should the same 400 hit one user only, that user's organisation does not accept the beta (the documentation does not say whether that can happen); the user switches fallbacks off (C16).
- New on 2026-11-20: `auth_failed` from an upstream 401 also sets the caller's `user_api_keys.status` to `rejected` (C15.5). An organisation with an IP allowlist answers 403, which lands in `permission_denied`. Every upstream message passes the redaction of C15.6 before it is put into a response, an event or the turn row.

### C9. Limits and cost guards

The money is the user's own: every request is billed to the organisation behind that user's key. So the guards have three different jobs. The confirmation keeps a user from sending a large request by accident. The per-user limits bound what a client bug or a stolen sign-in can spend, and each account's share of the server. The server-wide limits keep the server usable for everybody. None of them is a budget; the user's budget is set at Anthropic (end of this section).

Before anything is loaded (C5, step 4): if `sessions.text_bytes` plus the UTF-8 bytes of the new text is above `CLAUDE_MAX_PROMPT_BYTES`, reject with `input_too_large`. One row decides; the transcript is not read and nothing is sent upstream. The default of 16 MiB is several times what 1,000,000 tokens hold by the documented ratio (roughly 2.5 million characters), so in practice it refuses only what the model would refuse as well; its purpose is to protect the server's memory.

Pre-flight size check, for both features:

1. `limit` = `model.contextWindow - 8000`, lowered to `CLAUDE_MAX_INPUT_TOKENS` when that is set and smaller. `threshold` = `CLAUDE_CONFIRM_ABOVE_INPUT_TOKENS`. For an id outside the registry the window is the one of C16.
2. `bound` = UTF-8 byte length of the system prompt and of all message texts + 16 per message + 64. A token covers at least one byte, so `bound` is an upper limit for the token count (inference; the per-message allowance is a guess at framing overhead).
3. If `bound` is at most `min(threshold, limit)`, skip counting: the request is certainly under both.
4. Otherwise call `client.messages.countTokens({model, system, messages})` with the model that will be used and with the caller's key. If that call fails with a retryable error (rate limit, overload, server error, network), use `ceil(characters / 2.5)` and mark the number as estimated. If it fails with any other error (for example a rejected key or an unavailable model), stop with the mapped error from C8.
5. If the count exceeds `limit`, reject with `input_too_large`.
6. If the count exceeds `threshold` and `confirmLargeInput` is not true, reject with `confirmation_required`, including a cost estimate when the registry has prices for the model (first message with the cache lifetime in force, and a later cached message). For a model without a price the dialog shows the token count and says that the app does not know the price. The client remembers the confirmation for the open chat and sends `confirmLargeInput: true` on later turns.

Guards on one request:

| Guard | Rule |
|---|---|
| New message length | At most `CLAUDE_MAX_USER_TEXT_CHARS`; request body limit 512 kB on the turn routes, 2 kB on the key route |
| Message count | The API accepts at most 100,000 messages in one request; reject more with `input_too_large` |
| Transcript size | `CLAUDE_MAX_PROMPT_BYTES`, above |
| Storage quota | A turn does not start when the caller's vault is at its limit (data-model.md 7.10) |
| One turn at a time per session | The partial unique index in C5 |
| Output | `max_tokens` as in C4 |
| Time | `CLAUDE_REQUEST_DEADLINE_MS` wall clock per turn, enforced by the server with an abort; the SDK's own timeout only bounds the wait for response headers |
| Authentication | Every Claude route requires a signed-in user; cross-site requests are refused (web-platform.md) |

Limits per user. They are counted over that user's rows only; one user's use never lowers what another user may do (data-model.md 7.12, rule I10).

| Limit | Default | Counted as | Refused with |
|---|---|---|---|
| Turns in flight | `CLAUDE_MAX_CONCURRENT_TURNS`, 2 | the user's running rows | `app_rate_limited` |
| Turn attempts in 10 minutes | `CLAUDE_MAX_TURNS_PER_10_MIN`, 30 | sum of `attempts` over the user's rows with `started_at` in the last 10 minutes | `app_rate_limited` |
| Turn attempts in a UTC day | `CLAUDE_MAX_TURNS_PER_DAY`, 300 | the same sum since 00:00 UTC | `app_rate_limited` |
| Attempts of one turn id | `CLAUDE_MAX_ATTEMPTS_PER_TURN`, 5 | `attempts` of the row | `app_rate_limited` |
| Key saves and checks per hour | `CLAUDE_MAX_KEY_CHECKS_PER_HOUR`, 10 | see below | `app_rate_limited` |
| Model id checks per hour | `CLAUDE_MAX_MODEL_LOOKUPS_PER_HOUR`, 30 | see below | `app_rate_limited` |

Limits for the whole server. They count all users together and read no user's content.

| Limit | Default | Counted as | Refused with |
|---|---|---|---|
| Turns in flight | `CLAUDE_MAX_RUNNING_TURNS_GLOBAL`, 20 | `SELECT count(*) FROM claude_turns WHERE status = 'running' AND heartbeat_at > now() - interval '60 seconds'` | `server_busy` |
| Turn attempts per minute | `CLAUDE_MAX_TURNS_PER_MIN_GLOBAL`, 60 | `SELECT COALESCE(sum(attempts), 0) FROM claude_turns WHERE started_at > now() - interval '1 minute'` | `server_busy` |
| Key saves and checks per hour | `CLAUDE_MAX_KEY_CHECKS_PER_HOUR_GLOBAL`, 120 | see below | `server_busy` |

Notes on counting:

- A row counts with all its `attempts` once its latest attempt lies in the window. That can count an older attempt again, by at most `CLAUDE_MAX_ATTEMPTS_PER_TURN` minus 1 per row; it never counts too little. Example: three rows started in the last 10 minutes with 1, 1 and 4 attempts count 6.
- Pre-flight refusals and failed turns keep their rows (C5, step 7), and a discarded turn keeps its row without text (C6). So every attempt that reached Anthropic is counted, and neither a loop of large requests nor a loop of send and discard gets under the limits.
- The check and the insert are not one atomic step: two requests that race can pass a limit by one. That is acceptable; these are guards. The one invariant, one running turn per session, is enforced by the unique index.
- The two server-wide statements above are the only statements of this document that read `claude_turns` without `owner_id = $1`. They return one number each. If row-level security is added (data-model.md 7.13), they are among the work that crosses users.
- Key checks and model id checks are not turns and have no table here. Count them with the limiter that phase 6 builds, keyed by user and action; web-platform.md 11.5 wants limiter state in Postgres. Until that exists, count them in process memory: that stops a loop and resets when the process restarts.

What protects the server, not the user's budget:

1. Only signed-in, active accounts reach a Claude route, and accounts exist by invitation only at first (`../HANDOFF.md` section 3). The owner can suspend an account (data-model.md 7.7); a suspended account can still remove its key.
2. The server has no Anthropic credential of its own (C15.7). A request that does not carry a user's own stored key cannot reach Anthropic, so nobody can spend the owner's money, and one user cannot spend another's.
3. The server-wide limits above bound memory, connections and database load whatever the number of accounts; the per-user limits bound each account's share of them.
4. Size limits bound what one request can make the server hold: the body limits, `CLAUDE_MAX_PROMPT_BYTES`, the message count, the storage quota. A running turn holds one transcript in memory; 20 turns of the largest allowed transcript stay well inside the 8 GiB measured in the workspace (the size of a published machine is not known).
5. Time limits end what hangs: the turn deadline, the heartbeat that marks a dead turn, one turn at a time per session.
6. The key routes cannot be used to try out keys in bulk: a local format check before any call, and a per-user and a server-wide limit on checks.
7. The server calls one fixed host, `api.anthropic.com`. No Claude route takes a URL, and nothing from the browser's request (cookies, `Origin`, other headers) is copied into the request to Anthropic.
8. Requests run under the user's key, so Anthropic's usage policies, rate limits and any enforcement apply to that user's organisation, not to the server's owner. What the users share is the server's network address: the server-wide limits keep its volume moderate.
9. Logs hold ids, sizes, codes and durations, never a prompt, a reply or a key (`../HANDOFF.md` section 8). The owner therefore cannot review what a user asked; misuse is handled by limits and by suspension, not by reading content.

The user's own budget. The authoritative spend guard is outside the app, and it is now each user's: a key made for one workspace, and a monthly spend limit for that workspace in the Claude Console. The key screen says so (design.md words it). The first version gave this advice to the owner about the server's key.

Very long sessions:

- A 1,000,000-character session is about 400,000 tokens by the documented ratio of 2.5 characters per token; code-heavy text can need more. It fits all four current models. It does not fit a 200,000-token model, which a user can add under C16.
- It will trigger the confirmation dialog. Typical costs are in the table before Part C.
- Rate limits can bite, and they are those of the user's organisation: on the Start tier `claude-fable-5-2` allows 500,000 input tokens per minute, so two uncached requests of this size within a minute cannot both pass; a new organisation can be below the Start tier, in the Evaluation tier, and can hit ramp limits. These arrive as `rate_limited`.
- The documentation warns that accuracy degrades as context grows. A later version can offer "continue from the summary" for such sessions (C12).

Hosting limits: how long the platform lets one response run, and whether work continues after the browser has gone, are open (web-platform.md 9.2 and 13.1). If those checks show a limit below the 20-minute deadline, lower `CLAUDE_REQUEST_DEADLINE_MS` and `CLAUDE_MAX_OUTPUT_TOKENS` so a reply fits, or use an always-on deployment. Nothing else in this document depends on the answer: a turn that is cut off ends as `interrupted` and can be retried.

### C10. Prompt caching rules

1. Chat requests carry top-level `cache_control` with the lifetime in force: the user's own setting when there is one, otherwise `CLAUDE_CACHE_TTL`; none when that is `off`. Summarize requests carry none: a single request never reads its own cache, and the write premium would be wasted.
2. The prefix must be identical from one turn to the next. That is guaranteed when: the system prompt is a constant; messages come from the database in a fixed order; texts are passed through unchanged; nothing variable (time, title, ids) is added; the model, the effort and the thinking settings do not change during a chat.
3. Changing the model during a chat is allowed and simply misses the cache once.
4. Record `usage` for every turn. In a healthy chat the second message within the TTL shows `cache_read_input_tokens` close to the whole previous prompt and a small `cache_creation_input_tokens`. If reads stay at zero, something in rule 2 is broken. This cannot be proven against a fake upstream; it is a manual check with a real key (C11).
5. Prompts under the model's minimum are not cached, without any error. The minimum is 512 tokens on the four current models and 1,024 to 4,096 tokens on older models, which a user can add under C16.
6. Optional refinement: also put an explicit `cache_control` with the same TTL on the last stored message's text block, so that a retry with an edited message, or a new message after a refusal, still reads the transcript from the cache.

Added on 2026-11-20:

7. The cache belongs to the organisation and the workspace of the key that made the request. Nothing is cached across users, and the server needs no rule of its own to keep users apart. A user who replaces their key by one from another workspace starts with an empty cache.
8. A lifetime is counted from the start of the request that wrote or read the entry, not from the end of its answer: with the five-minute lifetime, an answer that streams for four minutes leaves one minute for the next message.
9. The lifetime is a cost choice, and the user pays for it. One hour: the first message of a chat costs twice the input price, later messages within the hour a small fraction. Five minutes: 1.25 times, and later messages are cheap only while they follow within five minutes. Off: every message at the plain input price. The server default is the owner's decision (C14); a user may override it with `cacheTtl` (C6). The confirmation dialog of C9 shows the estimate for the lifetime in force.

### C11. Tests against a mocked upstream

No test may reach Anthropic. The key service takes the function that builds a client as a parameter. In tests that function is `(key) => new Anthropic({ apiKey: key, baseURL: "https://api.anthropic.com", fetch: fakeFetch, maxRetries: 0, logLevel: "off", openTelemetry: false })`, so every request still carries the key of the user it is made for. `fakeFetch` records the URL, headers and parsed JSON body, throws on any URL it does not expect, and returns a `Response` whose body is a scripted byte stream with `content-type: text/event-stream` and a `request-id` header. Match requests on the path (`/v1/messages`, `/v1/messages/count_tokens`, `/v1/models`, `/v1/models/<id>`); the beta namespace may add a query string.

Test data, all synthetic: user A has the key `sk-ant-api03-EXAMPLE-not-a-real-key-AAAA1111`, user B has `sk-ant-api03-EXAMPLE-not-a-real-key-BBBB2222`. Both pass the format check of C15.2; neither was ever a key. The test master key is the one of the vector in C15.3. Continuous integration has no variable whose name starts with `ANTHROPIC_`; test K10 sets one on purpose. The first version used one injected client with the key `test-key-EXAMPLE`.

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

HTTP error cases, each a JSON body `{"type":"error","error":{"type":"...","message":"..."},"request_id":"req_EXAMPLE02"}` with the given status: 400 with a "prompt is too long" message; 400 other; 401; 402; 403; 404; 413; 429 with `retry-after: 7`; 429 with `"details":{"error_code":"enforced_spend_limit_reached"}`; 500; 529. Assert the code, the HTTP status and the retry hint from C8. After the 401, the user's key has status `rejected`.

Request assertions:

- The body for the A13 fixture equals the expected web messages; `system` equals the constant; `max_tokens` is 64000; there is no `thinking`, `temperature`, `top_p`, `top_k` or `tools` key.
- Chat requests have `cache_control` with the lifetime in force; Summarize requests have none.
- `fallbacks` and the beta header are present exactly for registry models whose flag is on, and only while the user has not switched fallbacks off. Read headers through `new Headers(init.headers)`; the key arrives as `Authorization: Bearer <key of the user the request is made for>`. No request carries `x-api-key`, `anthropic-workspace-id`, `Origin` or `Cookie`.
- The pre-flight path calls `count_tokens` only above the byte bound, and rejects with `confirmation_required` and `input_too_large` at the right numbers.
- Neither test key appears in a response body, an event or a log line (K11).

State assertions: two sends for one session with different ids while the first is running, the second gets `turn_in_progress`; a repeated send with the same `clientTurnId` after a saved reply answers `done` without an upstream call; a repeated send after a failure regenerates from the stored text and commits exactly one user message; a sixth send of the same failed id answers `app_rate_limited`; a refused or failed chat leaves the message table unchanged; positions are consecutive after a commit and the session counters of data-model.md 7.3 still agree; a client that disconnects during U1 still finds both messages committed; Summarize with an existing summary and `replaceExisting` false makes no upstream call; a discarded turn has no text left and is not returned by the turn route.

Key tests (C15). "Upstream" is the fake one.

| # | Given and when | Then |
|---|---|---|
| K1 | A saves a key; `/v1/models` answers 200. | `200` with `status` `ok` and `last4` `1111` and no other field. One row for A. The upstream saw `Authorization: Bearer` with A's key, and no `anthropic-workspace-id`. |
| K2 | A and B have saved keys. Dump every column of every table as text: `pg_dump --data-only` where it is on PATH, otherwise a `SELECT` of every table with each `bytea` column in hex and in base64. | The dump holds neither key, no piece of 16 or more characters of either, and neither key in hex or base64. |
| K3 | A and B send turns (U1), some one after the other and two that overlap in time. | Every upstream request made for A carries A's key and every request made for B carries B's. |
| K4 | Copy `ciphertext`, `nonce` and `key_version` of A's row into B's row with SQL. B sends a turn. | `key_unreadable`. The upstream sees no request. |
| K5 | A's turn is streaming (U10). A calls `DELETE /api/claude/key`. | The upstream request is aborted within 1 second when the same process holds the turn, within 3 seconds through a second process. The turn ends. A has no row in `user_api_keys`. A new turn of A answers `not_configured`, and no upstream request follows. B's turn, running at the same time, is untouched. |
| K6 | A replaces the key by a second synthetic key. | The row has the new `last4`, a new `nonce` and `created_at`; no column holds anything of the old key; the next upstream request carries the new key. |
| K7 | A saves a key while `/v1/models` answers 401; 400 with the workspace message; 403; 500; nothing at all. | 401: `key_rejected`. 400 and 403: `key_unusable`. In these three cases nothing is stored and a key that A already had is still there. 500 and no answer: stored with status `unknown`. |
| K8 | A saves: an empty string; 600 characters; a key with a space inside; `sk-ant-admin01-EXAMPLE-not-a-real-key`; `hunter2-EXAMPLE-not-a-key-000000`. | `validation` with the reason of C15.2 each time. The upstream sees no request. |
| K9 | The upstream answers a turn with an error whose message repeats the value of the `Authorization` header. | The key is in no response body, event, `error_message` column or log line; `[redacted]` stands in its place. |
| K10 | `ANTHROPIC_API_KEY` is set to a marker value, in a test environment that is not a published app. A user without a stored key sends a turn; then A sends a turn. | First: `not_configured`, no upstream request. Second: the request carries A's key. The marker is in no request (data-model.md 7.8). |
| K11 | Capture every response body, every stream event and the whole log of the suite. | Neither key appears anywhere. `GET /api/claude/config` shows `1111` and no longer piece of A's key. |
| K12 | A's key is stored under master key 1. Add master key 2, set `USER_KEY_ENC_VERSION` to 2, send a turn. | The turn works; the row now has `key_version` 2 and a new nonce. It still works after the secret of version 1 is removed. |
| K13 | The vector of C15.3. | The key service's seal function, given that master key, nonce and user id, yields exactly the stored bytes; its open function returns the key; with another user id it fails. |
| K14 | Check A's stored key while `/v1/models` answers 401. Send a turn while the upstream still answers 401, then one while it answers normally. | After the check: status `rejected`. The first turn is sent upstream and ends with `auth_failed`. The second works, and the status is `ok` again. |
| K15 | Start with `REPLIT_DEPLOYMENT` set to `1` and `ANTHROPIC_BASE_URL` set, once to a value and once to an empty string. | A turn, a key save and a key check answer `key_service_unavailable`; the upstream sees no request; `DELETE /api/claude/key` still works. |

Tests with two users (C19). A and B each have sessions, a key and turns.

| # | Given and when | Then |
|---|---|---|
| X1 | As A, call every route that takes a session id with the id of B's session, and with a random id. | The same status and body both times: `404 not_found`. B's rows are unchanged (data-model.md 7.12, rules I2 and I4). |
| X2 | B sends a `clientTurnId` that A has used: once while A's turn runs, once after it was saved. | B gets a turn of B's own. No `turn_in_progress`, no replay of A's `done`. |
| X3 | A reads `config`, `models` and the turn route. | Nothing of B's key state, preferences, models or turns is in any answer. |
| X4 | A reaches the per-user limits. | B's turns start. |
| X5 | Turns of A and B fill the server-wide limit. | A third user's turn answers `server_busy`. |
| X6 | A's account is deleted (data-model.md 7.11) while a turn of A is streaming. | The turn ends without a commit. No row of A is left in `claude_turns` or `user_api_keys`. B is unchanged. |
| X7 | A is suspended. | Continue, Summarize, key save, key check: `403 account_suspended`. Key removal, stop and discard work. |

Model tests (C16).

| # | Given and when | Then |
|---|---|---|
| M1 | `/v1/models` lists the four registry ids and `example-model-1` with `max_input_tokens` 200000 and `max_tokens` 64000. A saves a key. | `GET /api/claude/models` has five entries; the fifth has `inRegistry` false and `priceClass` `unknown`. The `GET` itself made no upstream request. |
| M2 | A adds `example-model-1` and sends a turn with it. | The upstream body has no `fallbacks` and no `output_config`; there is no `anthropic-beta` header; `max_tokens` is 64000; `cache_control` is as configured. |
| M3 | A adds an id that the key's list does not hold; `/v1/models/<id>` answers 404, and in a second run 500. | 404: `validation`, nothing is stored. 500: the id is stored without values, and a turn with it uses 16000 and 200000 (C16). |
| M4 | A turn names a model that is neither in the registry nor among A's ids. | `validation`; no upstream request. |
| M5 | The key's list lacks `claude-fable-5-2`. | It is not in `config.models`; `GET /api/claude/models` shows it with `available` false. |
| M6 | A sets `fallbacks` to false and sends a turn with `claude-opus-5-5`. | No `fallbacks`, no beta header. |
| M7 | A adds ids with a slash, with a space, with a non-ASCII letter, and of 201 characters. | `validation` each time; no upstream request. |

Tests for C17 and C18.

| # | Given and when | Then |
|---|---|---|
| N1 | A chat request for the A13 fixture with the text `"  How often should I water mint?\n"`. | The last message of the upstream body is exactly `How often should I water mint?`. Apart from the placeholder at position 0, no message was added. `system` equals the constant. |
| N2 | Any chat or Summarize request. | No `output_config.format`, `tools` or `stop_sequences`; the last message has the role `user`. |
| N3 | Import, capture, a sync push, a feed pull, opening and editing a session, every `GET` route. | The upstream sees no request. Only Continue, Summarize, a key save, a key check and the check of a model id ever call Anthropic. |
| N4 | A truncated chat reply (U5). | No further request follows by itself, and no message with a ready-made text is stored. |
| W1 | U1. | `done.assistantMessage.text` equals the stored `messages.text` and equals the joined deltas after `trim()`. A second device that fetches the transcript receives the same string. |
| W2 | U5 and a stopped U10. | The stored text is the partial text only; the marker is in `extra.x_claude` and not in the text. |

Tests with a second device (C19, sync.md section 11).

| # | Given and when | Then |
|---|---|---|
| D1 | Device 1 runs U1. Device 2, same user, pulls the change feed. | The session comes with a higher `seq` and a `message_count` that is 2 larger. Device 2 fetches two messages, equal to those of `done`. |
| D2 | A turn is running. A device pushes `session.delete` for that session. | Refused with `turn_in_progress` (sync.md 6.5). After the turn, a delete that names the old `seen_message_count` is refused with `unseen_messages`. |
| D3 | The session's messages are replaced by an interchange import while a turn runs. | The turn ends with `session_changed`; no message is appended. |
| D4 | Summarize saves. | The feed delivers the session with the new `summary`; `search_text` contains it. |
| D5 | Run the check queries of data-model.md 7.3 and 7.10 after the whole suite. | No rows. |

Browser parser tests: an event split across chunks; a multi-byte character split across chunks; `\r\n` line ends; comment lines; a stream that ends without a final event.

Manual checks with a real key, once, by the owner. The owner enters a key in the settings screen like any other user: a key made for one workspace, with a spend limit set for that workspace. Then: each model of the list answers a one-line prompt; the second message of a chat on a session longer than about 2,000 characters reports cache reads above zero; Stop ends a reply within about a second; a deliberately wrong key is refused on entry with `key_rejected`; after the key is disabled in the Claude Console the next turn ends with `auth_failed`, and after it is enabled again the next turn works; removing the key in the app ends a running reply within about a second. The real key is never put into the workspace, a file, a test or a log.

How this covers the "done when" of phase 4 in `../HANDOFF.md` section 7:

| `../HANDOFF.md` | Covered by |
|---|---|
| With a scripted fake upstream, the cases in C11 pass. | Everything above. |
| No response of this server ever contains a key. | K1, K9, K11. |
| Keys are unreadable in a database dump. | K2. |
| One user's key is never used for another user's request. | K3, K4, K10. |
| The owner has made one real exchange with a real key. | The manual checks. |

### C12. Not in the first version

- Server-side compaction, message threads, batches, tools, files and extended output: none is needed, and compaction would require storing non-text blocks in the vault.
- Showing thinking summaries (`thinking.display: "summarized"`).
- "Continue from the summary": for sessions above the confirmation threshold, send the saved summary plus the new messages in place of the full transcript. Cheaper and faster, loses detail.
- Sharing one cached prefix between chat and Summarize by sending the summarize instruction as a final user message after the same system prompt and messages. It changes the Summarize prompt, so it needs its own evaluation.
- An "Extract code" action. The earlier iOS code has such a prompt for an on-device model (`reference/session-capture-ios/SessionCapture/Summarizer.swift:45-51`); it never called Claude. Since 2026-11-20 it would also be a preset question, which `../HANDOFF.md` section 1 rules out (C17).

Added on 2026-11-20:

- Linked billing. Anthropic launched it in beta on 2026-11-17: a user links their Claude organisation to an app through OAuth and pays for the requests the app marks; the app never holds a key of the user. It would replace C15 as a whole. Not built: it is a beta that "might not be suitable for production use"; the requests would run in the owner's organisation, under its rate limits, model access and data retention; it needs the owner to register an OAuth app and a federated identity for the server; and it leaves out users whose organisation is billed through a cloud marketplace or has only a subscription plan. The decision of `../HANDOFF.md` section 2 is a key that each user brings.
- Keys that are not made for one workspace. They would need a stored workspace id and the `anthropic-workspace-id` header, and they can also call the Admin API of the user's organisation (C15.2).
- More than one key per user, or a key per device.
- Showing a user what they spent. Anthropic's usage and cost reports need a credential that can call an organisation's management APIs, which this app refuses to hold (C15.2). The `usage` of each turn is stored in `claude_turns` and could be shown as token counts.
- Tool calls and tool results of structured transcripts in a prompt (C3).
- A choice of effort, thinking display or fast mode per user.
- Reading what the users ask. The server keeps no prompt or reply outside the user's vault and logs none (C9).

### C15. The user's API key: custody and lifecycle

New on 2026-11-20. data-model.md 7.8 defines the table `user_api_keys` and the stored form of a key. This section defines everything around it: who holds what, how a key is entered and checked, how it is used, what its status means, how it is replaced and removed, what is shown, and what never leaves the server. data-model.md wins for columns and bytes; this document wins for routes, checks and codes. The tests are K1 to K15 in C11.

#### C15.1 Who holds what

| Thing | Where it is | Who can read it |
|---|---|---|
| A user's API key, plain | With the user. In the one HTTPS request that saves it. In the memory of the server process while it is checked and while a request of that user runs. | The user; the server process, for those moments. |
| A user's API key, encrypted | `user_api_keys.ciphertext` | Nobody without the master key. |
| The master key | The platform's secret store, as `USER_KEY_ENC_KEY_V<n>`, and the memory of the server process. Never the database, the repository, `.replit`, a file or a log. | Whoever can read the production secrets. |
| The last four characters | `user_api_keys.last4` | The user, in the settings; whoever can read the database. |

What that gives, said plainly, because the owner's privacy text has to match it:

| Someone who has | Gets a user's key? |
|---|---|
| A database dump, a backup, the point-in-time history, a read replica, the SQL console | No: ciphertext, nonce, version and four characters. |
| The master key alone | No. |
| The production secrets and the production database together | Yes, every stored key. On the hosting platform that is the owner, and whoever the owner or the platform lets read both (web-platform.md 10.4 and 10.9). |
| Control of the running server process | Yes: the master key, and every key that is used while the control lasts. |
| Another user's sign-in | No. A key is read only for the user of the sign-in session, and that user's id is part of what the encryption authenticates. |
| The user's browser, a script injected into the page, the offline copy on a device | No. The key is not sent back after it was entered. |
| The logs | No, as long as C15.6 holds; K9 and K11 search for it. |

So a stored key is protected at rest and against other users. It is not hidden from whoever operates the server: the server has to be able to decrypt the key in order to use it.

#### C15.2 Entering a key

1. The page sends the key once, as the body of `PUT /api/claude/key` (C6), over HTTPS. The page stores it nowhere: not in `localStorage`, IndexedDB, a cookie, a URL or the outbox. It empties the field when the answer arrives.
2. Local checks, in this order, before anything is stored or sent to Anthropic. The first that fails answers `400 validation` with the reason in `details.reason`:

   | Check on the value after `trim()` | Reason |
   |---|---|
   | It is empty | `empty` |
   | It is longer than 512 characters | `too_long` |
   | It has a character outside U+0021 to U+007E: white space inside, a control character, anything that is not printable ASCII | `bad_characters` |
   | It starts with `sk-ant-admin` | `admin_key` |
   | It does not start with `sk-ant-api`, or it is shorter than 20 characters | `not_an_api_key` |

   The first three are the checks of data-model.md 7.8. The last two keep anything that is not an ordinary API key from being stored and from being sent to Anthropic at all: a password pasted by mistake goes nowhere. `sk-ant-api` is the documented form on 2026-11-20 and is one constant in the key service.
3. Limits: `CLAUDE_MAX_KEY_CHECKS_PER_HOUR` for the user, and its server-wide twin (C9).
4. Check with Anthropic: one call, `client.models.list({ limit: 1000 })`, with a client built from the candidate key (`clientFor`, C4), a timeout of 10 seconds and one retry. The call uses no tokens and returns what C16 needs. The server never sends the header `anthropic-workspace-id`.

   | Anthropic answers | Meaning | The server |
   |---|---|---|
   | 200 | The key is accepted. | Stores it with status `ok` and `checked_at` now. Keeps the list for C16. |
   | 401 | Wrong, disabled, deleted or expired. | Stores nothing: `key_rejected`. A key the user already had stays. |
   | 400 or 403 | The key cannot be used from here: it is not made for one workspace, the organisation is on hold, an IP allowlist shuts this server out, or another reason that the message states. | Stores nothing: `key_unusable`, with the upstream message as detail. |
   | 429, 5xx, no answer | Anthropic could not be asked. | Stores the key with status `unknown`, so that an outage does not block the user. The first turn or a later check settles the status. |

5. Store, as data-model.md 7.8 says: encrypt with the current master key and a new nonce; one statement that inserts the row or overwrites every column of the existing one. What the process remembered about the models of the previous key is replaced by the list just read, or dropped when Anthropic could not be asked.
6. Answer `{"status", "last4"}` and nothing else.

Why only a key made for one workspace. A key that is not scoped to a workspace needs a workspace id on every request, and Anthropic's Admin API accepts such a key with the role of its owner. A key made for one workspace needs no id and cannot reach the Admin API. Because the server never sends `anthropic-workspace-id`, an unscoped key fails the check with a 400 and is refused (from the documentation; not tested). An Admin API key of a Claude Console organisation is refused by its prefix. A scoped key of a Claude Enterprise organisation starts with `sk-ant-api01-` like an ordinary key; it is expected to fail the check, because it works only with the APIs its scopes cover (inference).

What the check proves: that Anthropic accepted the key for one call at that moment. It does not prove that a given model is available to it (C16), that the account has credit, or that the key will work tomorrow.

What the key screen has to tell the user (design.md words it). The Apple screen of A11 is the starting point, but its sentence about the Keychain is wrong here: the key is stored on this app's server, encrypted, and is sent only to Anthropic. Keys are made in the Claude Console at `platform.claude.com/settings/keys`. Make a key for this app alone and for one workspace; set a spend limit for that workspace in the Console. The key can be checked, replaced and removed here at any time; deleting it in the Console is what makes it useless everywhere.

Examples of the local checks (run for this document):

| Input | Result |
|---|---|
| `"  sk-ant-api03-EXAMPLE-not-a-real-key-AAAA1111 \n"` | Accepted as `sk-ant-api03-EXAMPLE-not-a-real-key-AAAA1111`; `last4` is `1111` |
| `""`, `"   "` | `empty` |
| 513 times `a` | `too_long` |
| `"sk-ant-api03-EXAMPLE not-a-real-key"` | `bad_characters` |
| `"sk-ant-admin01-EXAMPLE-not-a-real-key"` | `admin_key` |
| `"hunter2-EXAMPLE-not-a-key-000000"` | `not_an_api_key` |
| `"sk-ant-api03-short"` | `not_an_api_key` |

#### C15.3 Stored form and master key

data-model.md 7.8, in short: AES-256-GCM. The stored `ciphertext` is the encrypted key followed by the 16-byte tag. `nonce` is 12 random bytes, new for every encryption. The associated data is the ASCII string `sessionvault:user-api-key:` followed by the lower-case `owner_id`. `key_version` names the master key. A master key is 32 random bytes, base64, in the secret `USER_KEY_ENC_KEY_V<n>`; `USER_KEY_ENC_VERSION` names the one that encrypts new and replaced keys.

This is envelope encryption with the wrapping key held outside the database: the platform's secret store protects the master key, and the master key wraps each user's key. There is no further data key per row. A row is a few dozen bytes, encrypted once under a random 96-bit nonce; the limit of that construction, 2^32 encryptions under one master key (NIST SP 800-38D; from prior knowledge, not read again), is far away.

Sketch for Node; not compiled or run:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const TAG = 16;
const aad = (ownerId: string) => Buffer.from("sessionvault:user-api-key:" + ownerId.toLowerCase(), "utf8");

// The nonce parameter exists for the test vector only. The product never passes it.
export function sealKey(masterKey: Buffer, ownerId: string, apiKey: string, nonce: Buffer = randomBytes(12)) {
  const cipher = createCipheriv("aes-256-gcm", masterKey, nonce, { authTagLength: TAG });
  cipher.setAAD(aad(ownerId));
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext, nonce };
}

export function openKey(masterKey: Buffer, ownerId: string, ciphertext: Buffer, nonce: Buffer): string {
  const body = ciphertext.subarray(0, ciphertext.length - TAG);
  const decipher = createDecipheriv("aes-256-gcm", masterKey, nonce, { authTagLength: TAG });
  decipher.setAAD(aad(ownerId));
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - TAG));
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}   // final() throws when the master key, the nonce, the user id or any stored byte is wrong
```

Test vector. Synthetic values; computed with Apple CryptoKit and reproduced by a second implementation written from the AES and GCM definitions:

| Item | Value |
|---|---|
| Master key | The 32 bytes `00` to `1f`; in base64 `AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=` |
| Nonce | The 12 bytes `00` to `0b`; in hex `000102030405060708090a0b` |
| `owner_id` | `00000000-0000-4000-8000-0000000000aa` |
| Associated data | `sessionvault:user-api-key:00000000-0000-4000-8000-0000000000aa` (62 bytes) |
| Key | `sk-ant-api03-EXAMPLE-not-a-real-key-AAAA1111` (44 bytes) |
| Stored `ciphertext`, 60 bytes, in hex | `3469fb7aab91ef7afd28a7b89cac202cce86cb71dd1530081506c8f778086c9f6a75d7d1ee8053d945954edc00f01507ecf851ec31694ff9fe449544` |
| `last4` | `1111` |

Opening the same bytes with the user id `00000000-0000-4000-8000-0000000000bb`, or with another master key, fails. A fixed nonce exists in this vector only.

Master keys in operation (in a published app the key service refuses the master key of the test vector above, with `key_service_unavailable`, so that the published value can never protect real keys; one test asserts it):

- Make one with `openssl rand -base64 32`. The production value is set by the owner in the platform's production secrets and exists nowhere else (web-platform.md 13.3); the workspace has a throw-away value of its own.
- At start the key service checks: `USER_KEY_ENC_VERSION` is a whole number of at least 1, and the secret of that version decodes to exactly 32 bytes. If not, keys cannot be saved or replaced (`key_service_unavailable`), and the log says which name is missing or malformed, never a value. Stored keys of other versions keep working while their secrets exist.
- Rotation, and what the loss of a master key means: the table in data-model.md 7.8. Before a secret is removed, `SELECT key_version, count(*) FROM user_api_keys GROUP BY key_version` must show no row of its version.

#### C15.4 Using a key

The key service is one server module. It is the only code that reads or writes `user_api_keys` and the only code that ever holds a plain key (data-model.md 7.8). Its surface:

```ts
interface KeyState {
  status: "ok" | "unknown" | "rejected";
  last4: string;
  savedAt: string; checkedAt: string | null; lastUsedAt: string | null;
}
interface KeyService {
  save(ownerId: string, input: string): Promise<{ status: "ok" | "unknown"; last4: string }>;  // C15.2
  check(ownerId: string): Promise<KeyState>;                                                  // C15.5
  remove(ownerId: string): Promise<void>;                                                     // C15.5
  state(ownerId: string): Promise<KeyState | null>;                                           // never the key
  withClient<T>(ownerId: string, run: (client: Anthropic) => Promise<T>): Promise<T>;         // the only way to Anthropic
}
```

`ownerId` is always the user of the sign-in session. No caller passes an id that came out of a request.

`withClient`:

1. Read the row `WHERE owner_id = $1`. No row: `not_configured`. A key with status `rejected` is still used: that is how a key that works again is found out.
2. Take the master key that `key_version` names and decrypt with that user's associated data. A missing master key or a failed decryption: `key_unreadable`. Log the user id and the version, nothing else. Do not delete the row: after a deployment that lacks a secret, deleting would destroy every stored key.
3. Build the client with `clientFor` (C4) and run the function. The function gets the client, never the key string. Nothing keeps the key or the client after the function has ended: no cache, no pool, no module variable.
4. Afterwards: set `last_used_at`. An upstream 401 sets the status to `rejected`. A success on a key whose status is not `ok` sets `ok` and `checked_at`. A row with an older `key_version` is encrypted again under the current one (data-model.md 7.8).

#### C15.5 Status, check, replace, remove

| `status` | Meaning | Set by | Claude routes |
|---|---|---|---|
| `ok` | Anthropic accepted the key at `checked_at`. | A save, a check, a successful call. | Work. |
| `unknown` | Stored, but Anthropic could not be asked yet. | A save during an outage. | Work; the first call decides. |
| `rejected` | Anthropic answered 401 with it the last time. | A check, or any upstream call. | Still try the key. If Anthropic accepts it, the status becomes `ok`; if not, the answer is `auth_failed` again. The interface warns before sending (design.md 4.6.7). |

- A key can stop working at any time: it expires, or it is disabled or deleted in the Claude Console. The next call finds out and sets `rejected`.
- Check again (`POST /api/claude/key/check`): the Models call of C15.2 with the stored key. 200 sets `ok`; 401 sets `rejected`; anything else leaves the status as it is. A key that was disabled in the Console and enabled again comes back this way, or with the next turn, without being typed again; the Console shows a key only once, so the user may not be able to type it again. An expired or deleted key does not come back: replace it.
- Replace: the same route and the same checks as the first save. A replacement that fails a check leaves the stored key untouched. A turn that is running goes on with the key it started with.
- Remove (`DELETE /api/claude/key`). In one transaction: delete the row, and set `cancel_requested` on every running turn of the user. Then abort the turns that live in this process. Turns in another process stop with their next heartbeat, within 2 seconds (C5). From the moment the row is gone no request can start: every Claude route answers `not_configured`. The stopped turns end like turns the user stopped (C7): text that had arrived is kept, because the user has paid for it.
- What removing does not do: the deleted row stays in the platform's point-in-time history and backups until they age out, and Anthropic knows nothing of the removal (data-model.md 7.8). The settings say that deleting the key in the Claude Console is what makes it useless at once.
- Account deletion removes the row with everything else (data-model.md 7.11). Signing out has nothing of the key to remove from a device, because nothing of it was ever there.

#### C15.6 What is shown, and what never appears

Shown to the user, and only to that user:

| Shown | From |
|---|---|
| Whether a key is stored | A row exists. |
| "Ends in" and four characters | `last4` |
| Ready, not checked yet, or rejected | `status` |
| When it was saved, last checked, last used | `created_at`, `checked_at`, `last_used_at` |

Never:

1. No response, stream event, error message or turn row contains a key, or more of one than `last4`. Not for the user who owns it either: there is no "show key" and no export of it.
2. No log line, error report or test snapshot contains a key, a ciphertext or a master key. The key route logs no body. The SDK's logging and tracing are switched off in code (C4).
3. Redaction. Before a message that came from Anthropic is put into a response, an event, `claude_turns.error_message` or a log line: replace every occurrence of the key of that request by `[redacted]`, and after that every match of `sk-ant-[A-Za-z0-9_-]{8,}`. Anthropic's messages are not known to repeat a key; this is a second line of defence.
4. Never log an SDK error object as a whole. Log its status, type, error code and request id.
5. The key is never in the change feed, the offline copy, an interchange file, a vault export, `user_settings`, a URL or a cookie, and the request that saves it is never queued (data-model.md 7.8; sync.md section 10).
6. One user's row is never used for another user's request: the key service takes the user id from the sign-in session, and a mix-up fails to decrypt (data-model.md 7.8).

Examples of the redaction (run for this document); the key of the request is user A's test key:

| Message from upstream | After redaction |
|---|---|
| `invalid bearer token: sk-ant-api03-EXAMPLE-not-a-real-key-AAAA1111` | `invalid bearer token: [redacted]` |
| `key sk-ant-api03-EXAMPLE-not-a-real-key-BBBB2222 is disabled` | `key [redacted] is disabled` |
| `Overloaded` | `Overloaded` |

#### C15.7 The server has no Anthropic credential of its own

1. `clientFor` (C4) is the only place where a client is built, and it refuses anything but a non-empty key string. A client built without a key would take a credential from the environment or from a profile on disk, and then one failed decryption would quietly spend somebody else's money: the owner's, if a server key were still set.
2. The published app has no environment variable whose name starts with `ANTHROPIC_`. What the SDK would do with one:

   | Variable | Effect |
   |---|---|
   | `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` | A credential for every client that is built without one. |
   | `ANTHROPIC_PROFILE`, `ANTHROPIC_CONFIG_DIR`, the federation variables (`ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`, `ANTHROPIC_IDENTITY_TOKEN`, `ANTHROPIC_IDENTITY_TOKEN_FILE`) | The same, through a profile or a token exchange. |
   | `ANTHROPIC_BASE_URL` | Requests, each with a user's key in it, go to another host. |
   | `ANTHROPIC_CUSTOM_HEADERS` | Extra headers on every request of every client. |
   | `ANTHROPIC_LOG` | At `debug`, request and response bodies in the log. |
   | `ANTHROPIC_OPEN_TELEMETRY_TRACES_CONTENT_MODE` | Decides what a trace span carries. |

   A variable that is set to an empty string counts as set.
3. At start, in the published app (`REPLIT_DEPLOYMENT` is `1`): if any variable with such a name exists, every route that would call Anthropic or save a key stays off and answers `503 key_service_unavailable`, and the log names the variables, never their values. Removing a key keeps working. In the workspace the same check only warns, because the builder's own tools may need such a variable there; rule 1 and test K10 are what keep it unused.
4. The published image holds no Anthropic profile directory (`~/.config/anthropic`).
5. The request to Anthropic is built by the SDK from the output of the prompt module. Nothing of the browser's request is copied into it: no header, no cookie, no `Origin`. Anthropic refuses some organisations' requests that carry an `Origin` header, even from a server.
6. No hosting platform AI integration and no credential of the owner anywhere in the request path (C1, item 7).

### C16. Model choice

New on 2026-11-20. `../HANDOFF.md` section 1: the model list is the user's choice, not a fixed menu. The tests are M1 to M7 in C11; the chooser is design.md 4.15.6.

Three sources:

| Source | What it is | Where it lives |
|---|---|---|
| Registry | The models this app knows, with name, context window, output limit, fallback flag, effort, price class and prices. Every user is offered them. | Server configuration (C2). |
| The key's models | What Anthropic lists for the user's key: `id`, `display_name`, `lifecycle`, `line`, `max_input_tokens`, `max_tokens`. | Asked from Anthropic with that key; kept in process memory, per user, for an hour; never stored as a whole. |
| The user's own ids | Any further model ids the user added, in the order added, and the user's default model. | `user_settings.data`, keys `claude_models`, `claude_model_info` and `claude_default_model` (data-model.md 7.7, rule 5). |

How the server finds out what a key can use. It calls `client.models.list({ limit: 1000 })` with the user's key and follows `has_more` (the SDK's `for await` does that). Without a `lifecycle` filter the list holds active and deprecated models and no retired ones. The call is made when a key is saved and when it is checked again (`POST /api/claude/key/check`, which the settings also use as "refresh models"). No `GET` route makes it. The documentation calls the list the way "to determine which models are available for use in the API". It does not say, on the pages read, that the list is narrowed to what one organisation may use in every case; the reference bundled with Claude Code says that a model an organisation cannot use answers 404 exactly like an unknown one. So the list decides what is offered, and the first real request decides in the end: an upstream 404 is `model_unavailable`.

The user's own ids, set with `PUT /api/claude/preferences`:

1. `models` holds the ids the user added: at most `CLAUDE_MAX_USER_MODELS`, each once. A registry id in it is dropped, because the registry is offered anyway. An id must match `^[A-Za-z0-9][A-Za-z0-9._:@-]{0,199}$`: at most 200 characters, the limit of `model` in data-model.md 7.10, and nothing that could change a URL path. Anything else is `validation`, before any call.
2. Each new id is checked with the user's key: it is in the key's models in memory, or `client.models.retrieve(id)` answers 200. A 404 is `validation` with `details.reason` `model_unavailable`, and the id is not stored. If Anthropic cannot be asked (429, 5xx, no answer), the id is stored without values and the first request decides: an upstream 404 is `model_unavailable` (C8), and the id stays until the user removes it. These calls count against `CLAUDE_MAX_MODEL_LOOKUPS_PER_HOUR`.
3. Stored form. `claude_models` is the list of the added ids, as strings, in the order added. `claude_model_info` maps each of them to what the Models API said when it was added: `{"name", "context_window", "max_output_tokens"}`, from `display_name`, `max_input_tokens` and `max_tokens`; an id that could not be checked has no entry. A turn therefore needs no call to Anthropic of its own after the server has restarted. Values from the key's models, when they are in memory, take precedence over the stored ones.
4. `defaultModel` must be a registry id or one of the user's ids. It is stored as `claude_default_model`.
5. `null` for `models` removes the user's ids; `null` for `defaultModel` brings back `CLAUDE_DEFAULT_MODEL`.

The effective list is a pure function of the three sources:

1. Ids: the registry ids in registry order, then the user's own ids in the order added.
2. For each id, one entry:

   | Property | Id in the registry | Id outside the registry |
   |---|---|---|
   | `name` | registry name | `display_name` from the key's models, else the stored `name`, else the id |
   | `contextWindow` | `max_input_tokens` from the key's models when it is a number, else the registry value | `max_input_tokens` from the key's models, else the stored `context_window`, else 200,000 |
   | `maxOutputTokens` | `max_tokens` from the key's models when it is a number, else the registry value | `max_tokens` from the key's models, else the stored `max_output_tokens`, else 16,000 |
   | `serverSideFallbacks` | registry flag | false, always |
   | `effort` | registry value, if any | never set |
   | `priceClass`, `pricing` | registry values | `unknown`, none |
   | `inRegistry` | true | false |

3. `available`: true when the key's models are in memory and contain the id; false when they are in memory and do not; null when they are not in memory.
4. `GET /api/claude/config` returns the entries whose `available` is not false. A turn may name any id of that list.
5. Default model: the first of these that is in that list: the user's `claude_default_model`, `CLAUDE_DEFAULT_MODEL`, the first entry. With an empty list it is null, and the interface sends the user to the settings.

What an id outside the registry means for a request. "No fallback opt-in and conservative limits":

| Field | Id in the registry | Id outside the registry |
|---|---|---|
| `fallbacks`, beta header | When the flag, the server-wide switch and the user's switch all say yes | Never. An id the app does not know fails closed, as in the Apple app's fallback list. |
| `output_config` | The registry's effort, if any | Never |
| `max_tokens` | `min(CLAUDE_MAX_OUTPUT_TOKENS, maxOutputTokens)` | The same rule; 16,000 when Anthropic gave no limit |
| Context limit for the pre-flight (C9) | `contextWindow - 8000` | The same rule; 200,000 minus 8,000 when Anthropic gave no window. 200,000 is the smallest window among the models listed as active on 2026-11-20. |
| `cache_control` | As C10 | As C10. Caching is documented for all active models; a prompt under the model's minimum is simply not cached. |
| `thinking`, sampling parameters, tools | Never sent | Never sent. That request shape is valid on every model generation: the last message is always a user message, and nothing a newer or an older model rejects is in it. |
| Cost estimate in the confirmation | From the registry prices | None; the dialog says the price is not known to the app |
| Shown | Name and price class | Name from Anthropic and price class `unknown`; the settings list (`GET /api/claude/models`) also shows a `lifecycle` of `deprecated` |

Examples (run for this document). Registry as in C2; `CLAUDE_DEFAULT_MODEL` is `claude-opus-5-5`; `CLAUDE_MAX_OUTPUT_TOKENS` is 64000.

| # | User's own ids and default | Key's models in memory | Effective list | Default |
|---|---|---|---|---|
| 1 | none | the four registry ids | the four, in registry order | `claude-opus-5-5` |
| 2 | none | the four without `claude-fable-5-2` | opus, sonnet, haiku | `claude-opus-5-5` |
| 3 | `example-model-1`; default `example-model-1` | the four and `example-model-1` (200000, 64000) | the four, then `example-model-1` | `example-model-1` |
| 4 | as 3 | not in memory | the same five, each with `available` null; window and output limit of `example-model-1` from the stored values | `example-model-1` |
| 5 | none; default `claude-fable-5-2` | the four without `claude-fable-5-2` | opus, sonnet, haiku | `claude-opus-5-5` |
| 6 | `example-model-2`, stored without values | not in memory | the four, then `example-model-2` with window 200000 and output limit 16000 | `claude-opus-5-5` |

Request values for a chat turn in those examples, fallbacks not switched off by the user:

| Model | `max_tokens` | `fallbacks` and beta header | `output_config` | Pre-flight limit |
|---|---|---|---|---|
| `claude-opus-5-5` | 64000 | sent | none | 992000 |
| `claude-haiku-5-5` | 64000 | not sent | none | 992000 |
| `example-model-1` | 64000 | not sent | none | 192000 |
| `example-model-2` | 16000 | not sent | none | 192000 |

Two switches go with the model choice. Both are optional keys in `user_settings.data`, set through the same route; without them the server defaults apply:

| Key | Values | Meaning |
|---|---|---|
| `claude_fallbacks` | true, false | False: no `fallbacks` and no beta header on any request of this user. A declined request then stays declined, and only the chosen model ever answers. |
| `claude_cache_ttl` | `1h`, `5m`, `off` | The cache lifetime of C10 for this user's chat requests. |

The chooser: the client shows the effective list and never contains a model id of its own. "Other Model" in design.md 4.15.6 is `PUT /api/claude/preferences`: the typed id is added to the user's ids, and a turn may name it once that has answered 200. The chooser starts with the model remembered on this device if that is still in the list, else with `defaultModel`. Summarize uses the model its request names, else `defaultModel`; `summarizeModel` in the config answer is that id. When a `fallback` event says that another model answered, the interface says so, and the stored reply carries the answering model in `messages.model` (C5).

### C17. No preset questions and no forced output formats

New on 2026-11-20. `../HANDOFF.md` section 1: the user asks free-form questions about a saved session and takes the answer elsewhere; so no preset questions and no forced output formats. The rule, for everything in this document:

1. The text that is sent as the last user message, and stored as the user's message, is what the user typed, after `trim()` and the text hygiene of C5. Nothing is put before it or after it, no template wraps it, and nothing translates, expands or corrects it.
2. The app never sends a message the user did not type. It offers no ready-made questions, no suggestion chips and no follow-up buttons that send text.
3. No request asks for a reply format: no `output_config.format`, no tool that must be called, no stop sequence, no assistant message at the end, and no format instruction in the chat's system prompt. The reply is stored and shown as Claude wrote it, apart from `trim()`.
4. Summarize is the one fixed prompt. It runs only when the user presses it, once per press. Nothing else starts a Claude request: not import, not capture, not sync, not opening a session.
5. A reply is never post-processed into another shape: no extraction of code, no shortening, no added headings.

Every string and every rule of this document, checked against that:

| Item | Finding | Result |
|---|---|---|
| `CONTINUE_SYSTEM_PROMPT_V1` (A4) | Sets the context. Names no question and no format. | Kept, verbatim. |
| `EARLIER_TRANSCRIPT_PLACEHOLDER` (C3) | A framing line that the API needs when the transcript does not start with a user message. Sent only; never stored, never shown; not a question. | Kept. |
| `buildContinueMessages` (C3) | Passes stored texts through byte for byte and appends the user's text after `trim()`. | Kept. |
| `SUMMARIZE_SYSTEM_PROMPT_V1` (A4) | A fixed instruction, and it asks for code in fenced blocks. That is what the Summarize action is; it applies to that action alone. | Kept, verbatim. Runs only on the user's press. |
| C7, truncated chat reply, first version: offer to send `Please continue from where you left off.` | A ready-made question, sent and stored as if the user had typed it. | Removed. |
| C7, refused reply: `Try again with <model name>.` | A hint in a message. The user decides and sends; nothing is sent for them. | Kept. |
| C4: `output_config`, `tools`, `stop_sequences`, a final assistant message | Would force a format. | Never sent; N2 asserts it. |
| C9: confirmation above the threshold | Asks before sending; changes nothing in the text. | Kept. |
| C5: retry of a failed turn | Sends the stored text of the same turn again, unchanged. | Kept. |
| C12: "Extract code", "Continue from the summary" | The first would be a preset question; the second would change what is sent as context, not the question. | Both stay out of the first version. |
| Composer placeholder `Continue the conversation\u2026` (A10) | A placeholder, not text that is sent. | design.md's choice. |

One point is the owner's to judge (C14): the chat's system prompt tells the model to continue the earlier conversation, while the described use is to ask questions about it. The wording is kept as the Apple app has it until the owner decides otherwise.

### C18. Copying a message or a reply whole

New on 2026-11-20. `../HANDOFF.md` section 1: every message and every reply can be copied whole with one action, not only code blocks. data-model.md 7.14 has the rule for stored messages: the action copies `messages.text` unchanged. This section adds what the Claude flow needs.

1. After `done`, the user's message and the reply are stored messages, and their copy action copies `userMessage.text` and `assistantMessage.text` from the event, which are the stored strings. The client must not copy the text it put together from `delta` events: the stored reply is trimmed, and only the stored string is what the user's other devices show.
2. While a reply is streaming, it cannot be copied whole yet. The text is not final: a refusal can still discard all of it (C7). design.md 4.15.7 shows the control disabled until `done`; the Apple app shows none (A14). Selecting text by hand stays possible.
3. A truncated or stopped reply that was stored copies its stored text, which is the partial text and nothing else. The labels "cut off" and "Stopped" are not part of the copy; the marker lives in `extra.x_claude` (C5).
4. Partial text that stays on screen after a mid-stream error (C6) is not stored. Its control copies the text exactly as it was received (design.md 4.15.7): it is the user's paid output, and it is gone after a reload.
5. Summarize: the summary can be copied whole, saved or as a draft. The string is `summary` of the `done` event, which for a saved summary equals `sessions.summary`.
6. Nothing is added to a copy: no role label, no model name, no source line. Size is no reason to shorten it.
7. Stored messages can be copied without a connection when their text is on the device (sync.md 5.3). A reply cannot be made without a connection in the first place.

### C19. Many users and several devices

New on 2026-11-20. What the decisions of `../HANDOFF.md` section 2 mean for this area, beyond the key. The tests are X1 to X7 and D1 to D5 in C11.

Many users. The isolation rules of data-model.md 7.12 apply to every Claude route and to `claude_turns`:

| Rule of data-model.md 7.12 | Here |
|---|---|
| I1: every key starts with `owner_id` | `claude_turns` (C5). This document adds no other table. |
| I2: the user id comes from the sign-in session only | Every route of C6. The key service and the turn functions take it as their first argument. |
| I3: every statement names `owner_id` | Every statement on `claude_turns`, `user_api_keys`, `user_settings`, `sessions` and `messages` in this flow. The exceptions are the two server-wide counts of C9 and the operator's count of key versions in C15.3; each returns numbers only. |
| I4: another user's row is `404 not_found` | Every route with a session id (X1). A `clientTurnId` of another user matches nothing (X2). |
| I9: one user's key is never used for, shown to or decryptable as another user | C15; K3, K4, K10. |
| I10: one user's limits do not depend on another's data | The per-user limits of C9 (X4). The server-wide limits are the one deliberate exception: they are about the server. |
| I11: deleting an account leaves others unchanged | `claude_turns` and `user_api_keys` go with their user (data-model.md 7.11); X6. |
| I12: logs carry ids and sizes only | C5 and C15.6; K11. |

Several devices of one user. sync.md section 11 is the other half of this table:

| Event | What happens |
|---|---|
| A chat turn commits | The commit is one write transaction and gives the session one new `seq` (C5). Every other device of the user receives the session row with the larger `message_count` in its change feed, at its next run (within a minute while it is open; sync.md 2.5), and fetches the two messages (sync.md 5.1). Nothing else is needed for a reply to appear elsewhere. |
| The device that ran the turn | On `done` it may store the two messages itself when they continue its transcript (same `messages_rev`, positions `count` and `count + 1`), takes `session` from the event as the newer server row (sync.md 4.4, rule 1), and starts a sync run. |
| Summarize saves | An ordinary change of `sessions.summary`; it travels in the session row. A summary edit that a device queued while offline and that arrives later replaces it (sync.md section 7, case 2). |
| `sessions.model` is filled | It travels in the same session row. |
| A turn is running | Not synced. `claude_turns` is not in the feed, and streaming text is never written to IndexedDB. Another device learns of it only by reading `GET /api/sessions/:id/turn` when it opens the session with a connection; it can also stop the turn. |
| A device deletes the session while a turn runs | Refused with `turn_in_progress` (sync.md 6.5), using the definition of "running" in C5. |
| A device that has not seen the reply deletes the session afterwards | Refused with `unseen_messages` (sync.md section 7, case 5). A reply that was paid for is not lost to a stale list. |
| An interchange import replaces the session's messages while a turn runs | The commit sees another `messages_rev` and writes nothing: `session_changed` (C5). The import handler should refuse to replace the messages of a session with a running turn in the first place, with `turn_in_progress`; that rule belongs to data-model.md 6.7 and is proposed here. |
| The session exists only on a device (its create is queued, or it is a kept record) | The Claude routes answer `404 not_found`; the client does not offer Continue or Summarize for it (sync.md section 11, item 4). |
| No connection | No Claude action, no key action. Reading and copying stored messages works from the offline copy. |
| Sign-out, another user signs in on the device | Nothing of a key or a turn was on the device. The model remembered on the device is a model id in `localStorage`: remove it at sign-out, together with the local copy (sync.md 2.6). |
| The storage quota is reached | A new turn is refused before it starts; a reply that is already being generated is stored (data-model.md 7.10). |
| The account is suspended or deleted during a turn | The commit finds no active user row and writes nothing (C5). |

### C13. If the working assumptions change

The first version of this document assumed one owner, one server-side key and a vault on the server, and said here what would change otherwise. `../HANDOFF.md` section 2 has decided since: many users, one stored key per user, an online vault with an offline copy on each device. What this section described as "a bring-your-own key" is now the main design, with the key stored on the server (C15); the former main design is the first alternative below. All four are kept for the record. None is to be built.

If instead there were one owner and one server-side key (the design of the first version; see also data-model.md 11.5):

- The key would be the production secret `ANTHROPIC_API_KEY`, passed to one SDK client for the whole server. C15, the key routes and the tests K1 to K15 would not exist.
- `not_configured` would mean a server without a key, with status 503; `keyStatus` would be one value for the server; the registry could be refreshed with that key once an hour.
- The owner would pay for every request. The limits of C9 would guard the owner's budget, and the spend limit in the Claude Console would be the owner's.
- C3 to C8, C10 and the turn table would stand as they are; a single user needs them just the same.

If instead each user's key were kept in the browser and sent with every request:

- The server proxy would stay. The key would travel in a header over HTTPS with each Claude request; the server would build a client for that request and store nothing. There would be no master key and no `user_api_keys`.
- The cost: the key would sit in browser storage, where any script injected into the page can read it, and it would have to be entered on every device. The Markdown rendering of transcripts and replies would have to be sanitised without exception (design.md, web-platform.md).
- Not chosen: `../HANDOFF.md` section 3 stores the key on the server, encrypted, and never sends it back to a browser.

If instead the browser called `https://api.anthropic.com` itself (the form web-platform.md section 14 describes):

- Facts from the docs: the API accepts cross-origin browser requests only with the header `anthropic-dangerous-direct-browser-access: true`, which the TypeScript SDK sends when `dangerouslyAllowBrowser` is true; organisations with zero data retention or the Compliance API are refused even then, with a 401 whose message begins `CORS requests are not allowed for this Organization`.
- All of C5 to C9 would have to run in the browser, with no server guards and nothing to save a reply when the tab is suspended.
- Not chosen, for the same reason, and because Anthropic's documentation says to call from a back end.

If instead the vault lived only in the browser (IndexedDB, no server vault; data-model.md 11.1):

- The server could not load the transcript. The browser would send the stored messages with the request and commit the result itself. The Claude routes would become one stateless proxy, for example `POST /api/claude/stream` with `{clientTurnId, task, model, messages: PromptMessage[], text, confirmLargeInput}`. The server would still run C3, C4, C7, C8 and C9, so prompts and limits would stay server-controlled.
- That route would need request bodies of up to about 16 MB; a 1,000,000-character transcript is several megabytes of JSON.
- There would be no place to save a reply when the browser is gone, so a dropped connection would have to abort the upstream call. The turn journal would shrink to a usage table without a session reference, and the one-turn-per-session rule would be enforced only in the client.
- Not chosen: the server vault is the source of truth, and IndexedDB holds a copy of it (sync.md).

The other two assumptions (TypeScript stack, interchange with the Apple app) do not change this area. Messages created by Claude carry the answering model in the interchange field the draft schema already defines.

### C14. Decisions that are the owner's, with the default to build until answered

Decided since the first version, by `../HANDOFF.md`:

| Decision | Decided |
|---|---|
| Which Anthropic account pays | Each user's own key (`../HANDOFF.md` section 2). The owner pays for nobody. Not the hosting platform's managed integration. |
| Which models to offer | Each user may add any model id that their key can use (`../HANDOFF.md` section 1; C16). What stays with the owner is the registry: the models every user is offered, and the default a new user starts with. Default: the four current ids, `claude-opus-5-5` first. `claude-fable-5-2` costs twice as much per token; `claude-haiku-5-5` is the cheapest. |
| Session model label after continuing (decision 6 in data-model.md) | The answering model is stored on each new message. The session label is filled only when it is empty and the session's provider is Claude (`../HANDOFF.md` section 5; C5). The Apple app always overwrites it. |
| Preset questions, output formats | None (`../HANDOFF.md` section 1; C17). Summarize stays as an explicit action. |

Open. Build the default until the owner answers:

| Decision | Default in this document |
|---|---|
| Cache lifetime for chats | One hour as the server default; each user may change it (C10). The first message of a chat then costs double the normal input price, later messages within the hour cost a twentieth of it on the default model. Cheaper when a chat has three or more messages; dearer for a single question, which is the use `../HANDOFF.md` section 1 describes: one question on a 400,000-token session on `claude-opus-5-5` costs the user 1.60 USD without caching, 2.00 with the five-minute cache and 3.20 with the one-hour cache. The alternatives are five minutes, or off. |
| Summary field | One field, as today; Summarize asks before replacing existing text. The alternative is a separate field for the generated summary. |
| After a reply was cut off | Nothing ready-made: the user writes the next message (C7, C17). design.md 4.16, decision 10, has the same default. |
| Stop during a reply | The partial reply is kept and marked as stopped. The alternative is to discard it. The same answer applies when a reply stops because its user removed the key. |
| Thresholds | Ask before sending more than 100,000 tokens. Per user: 2 turns at once, 30 attempts per 10 minutes, 300 per day. Whole server: 20 turns at once, 60 attempts per minute (C9). |
| Disclosure | Continue and Summarize send the whole stored transcript, including sessions that came from other providers, to Anthropic through the server, with the user's own key and under the user's own Anthropic account. The Apple app does the same from the device without saying so. Show a short notice the first time, to each user: an acceptance remembered in a browser must not carry over to another user who signs in there. The wording is part of the owner's privacy text (`../HANDOFF.md` section 9). |
| Which keys are accepted | Only an ordinary API key made for one workspace (C15.2). The alternative, a key for several workspaces, needs a stored workspace id and hands the server a key that can also manage the user's organisation. |
| Fallback to another model after a refusal | On for the registry models that support it, as the Apple app does for its three; each user can switch it off (C16). The alternative is off unless a user switches it on: then only the chosen model ever answers. |
| The chat's system prompt | The Apple wording, unchanged (A4). It tells the model to continue the earlier conversation; the use `../HANDOFF.md` section 1 describes is asking questions about a saved session. Another wording would be a new constant, to be judged on real sessions (C17). |
| What users are told about their key | The owner's text. C15.1 lists the facts it has to match: encrypted at rest; never shown again; used only for the user's own requests; readable by whoever holds the production secrets and the database together. |
| Who can read the production secrets | The owner alone; no other collaborator on the hosting workspace, because the master key and the database together open every stored key (C15.1). |
| Showing the last four characters of a key | Yes (data-model.md section 12, item 13). |

## Sources

Read on 2026-11-19.

- Repository: `apple/SessionVault/ClaudeAPI.swift`, `apple/SessionVault/ContextPack.swift`, `apple/SessionVault/Models.swift`, `apple/SessionVault/Views/ContinueChatView.swift`, `apple/SessionVault/Views/SessionDetailView.swift`, `apple/SessionVault/Views/RootView.swift`, `apple/README.md`, `reference/session-capture-ios/SessionCapture/Summarizer.swift`.
- Anthropic documentation under `https://platform.claude.com/docs/en/`: `models/overview`, `about-claude/model-deprecations`, `about-claude/pricing`, `api/overview`, `api/versioning`, `api/migration-2026-10-21`, `api/errors`, `api/rate-limits`, `api/messages/create`, `api/beta/messages/create`, `api/models/list`, `manage-claude/authentication`, `build-with-claude/streaming`, `build-with-claude/handling-stop-reasons`, `build-with-claude/refusals-and-fallback`, `build-with-claude/prompt-caching`, `build-with-claude/token-counting`, `build-with-claude/context-windows`, `build-with-claude/thinking`, `build-with-claude/effort`, `build-with-claude/compaction`, `cli-sdks-libraries/sdks/typescript`, `release-notes/overview`.
- `https://github.com/anthropics/anthropic-sdk-typescript` at version 1.11.0: `README.md`, `helpers.md`, `examples/fallbacks.ts`, `src/core/error.ts`, `src/core/streaming.ts`, `src/lib/MessageStream.ts`, `src/lib/BetaMessageStream.ts`, `src/client.ts`, `src/resources/beta/messages/messages.ts`.
- The Claude API reference bundled with Claude Code (cache date 2026-11-03), used as a cross-check.

Read on 2026-11-20, for the revision.

- Repository at commit `e81828a`: the files above again, and `apple/SessionVault/Views/MessageView.swift`.
- `../HANDOFF.md`, and data-model.md and sync.md as revised on 2026-11-20.
- Anthropic documentation under `https://platform.claude.com/docs/en/`, read again: `models/overview`, `about-claude/model-deprecations`, `api/overview`, `api/versioning`, `api/migration-2026-10-21`, `api/errors`, `api/rate-limits`, `api/models/list`, `manage-claude/authentication`, `build-with-claude/refusals-and-fallback`, `build-with-claude/prompt-caching`, `cli-sdks-libraries/sdks/typescript`, `release-notes/overview`. Read for the first time: `api/models/retrieve`, `api/beta-headers`, `get-api-key`, `manage-claude/admin-api-keys`, `manage-claude/ip-allowlist`, `manage-claude/wif-reference`, `manage-claude/oauth-apps/organization-billing-connections`. Also `https://platform.claude.com/docs/sdk-versions.json`.
- `https://github.com/anthropics/anthropic-sdk-typescript`, main branch on 2026-11-20: `README.md`, and the doc comments on `ClientOptions` and the constructor in `src/client.ts`.
- The Claude API reference bundled with Claude Code (cache date 2026-11-03), again as a cross-check.
