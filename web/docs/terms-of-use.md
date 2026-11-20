# Terms of use: draft of the owner's text

> **Status (2026-11-20).** A draft, written at the owner's direction. Draft 0.2: on 2026-11-20 the owner asked the session that builds the web app to improve the wording of draft 0.1, because that wording came "from a person who has absolutely no legal experience". The facts about the product and every open choice were kept; the list "What draft 0.2 changed" below says what is new. It is not legal advice and no lawyer has read it. Sign-up must not open beyond invitations before the owner has approved a final text (web-platform.md 11.14). Everything under "Notes for the owner and the builder" is not part of the terms. Sentences in the terms that begin with "Owner to decide" mark what is not settled.

## Notes for the owner and the builder

What the owner said on 2026-11-20, and what this text is for:

- SessionVault is for personal use: each user's own conversations and project data, to manage complex work and to keep work that the user paid for.
- A saved session is not a complete record. The app does not translate or transcribe the activity of sub-agents, and a saved session can be missing agents, their subjects, and the decisions or the work of red teams or blue teams.
- There are terms of use, users agree to them, and they link to the rules of each AI provider on using its output to train or distil models.

Two prohibitions in the terms are the draft's wording of the first point, for the owner to confirm with the final text: not to pass on other people's conversations (section 3), and not to use the app to train or distil AI models (section 5).

What draft 0.2 changed, for the owner to confirm with the final text. No statement about what the product does was changed:

- Section 1 now says how the agreement comes about (by creating an account or by using the service), and gives four names a fixed meaning: "the Service", "your vault", "saved session" and "AI service".
- Section 3 has one new point: what you save remains yours, the operator claims no rights in it, and the operator may store and process it only as far as that is needed to provide the Service. The point names the three things this covers, so that it is true of the product: storage with the hosting service and its backups, sending a session to Anthropic on request, and opening a link on request.
- Section 11 now proposes wording on warranty and liability. It is still marked "Owner to decide", because it depends on the law chosen in section 14. It names no upper limit of liability: that stays an open choice.
- Section 12 now says that the operator may change the terms, and what a person who does not agree to a new version can still do. The second part repeats the note above on where the builder shows the terms.
- Section 15 is new: three general clauses (a part that cannot be enforced, acting late on a breach, the whole agreement). Neither section 11 nor section 15 settles the governing law, a place for disputes, arbitration, a duty of the user to pay the operator's costs, or a minimum age: draft 0.2 contains no clause on any of these beyond the "Owner to decide" sentences of section 14.
- The wording of every section was revised for clarity. The section numbers 1 to 14 and their subjects are the same as in draft 0.1.

Where the builder shows it (the entries are in corrections.md, 1.1.14, 1.2.5 and 1.5.14):

- The invitation and sign-up screen says "By creating an account you agree to the Terms of Use." with a link, above the button that creates the account.
- Settings, under About, links to it.
- The app serves the text itself, from its own build, at `/terms`. It never loads it from another site. The page shows this file from the heading "Terms of use" to its end, never these notes.
- The version of the terms and the time of the agreement are stored with the account. When the version changes, the app asks again before it opens: after sign-in, and in a browser that is already signed in the next time it is opened with a connection. A person who does not agree can still export the vault, delete the account and sign out.

The links in section 4 were checked on 2026-11-20:

| Provider | Page | Address | Date shown on the page | What it says about models | How it was checked |
|---|---|---|---|---|---|
| Anthropic | Usage Policy | `https://www.anthropic.com/legal/aup` | effective Nov 12, 2026 | Forbids using outputs to train an AI model, naming "model scraping" and "model distillation", without prior authorization | Page opened and read |
| Anthropic | Consumer Terms of Service | `https://www.anthropic.com/legal/consumer-terms` | effective Oct 8, 2025 | Section 3, "Use of our Services": not to develop competing products or services, including developing or training AI models | Page opened and read |
| Anthropic | Commercial Terms of Service | `https://www.anthropic.com/legal/commercial-terms` | effective Jun 17, 2025 | Section D.4, "Use Restrictions": not to build a competing product or service, including training competing AI models | Page opened and read |
| OpenAI | Terms of Use | `https://openai.com/policies/row-terms-of-use/`; Europe: `https://openai.com/policies/eu-terms-of-use/` | not read | Not read. A web search reports a rule against using Output to develop models that compete with OpenAI | Not opened: the page could not be loaded by the tool used for this check. Address and title were found through a web search; open the page in a browser before relying on it |
| OpenAI | Services Agreement (API and business customers) | `https://openai.com/policies/services-agreement/` | not read | Not read. A web search reports a ban on using Output to develop AI models that compete with OpenAI's products, with an exception that the search result did not show | As above |
| Google | Terms of Service | `https://policies.google.com/terms` | effective July 30, 2026 | Under "Don't abuse our services": not to use AI-generated content from its services to develop machine learning models or related AI technology | Page opened and read |
| Google | Gemini API Additional Terms of Service | `https://ai.google.dev/gemini-api/terms` | effective March 23, 2026 | Under "Use Restrictions": not to use the services to develop models that compete with them | Page opened and read (the address forwards to `aistudio.google.com/docs/terms`) |

A second attempt to open the two OpenAI pages, from the Replit workspace on 2026-11-20, was refused in the same way (HTTP 403). Section 4 therefore still says nothing about what they contain.

Not linked on purpose (both pages opened and read on 2026-11-20): Google's "Generative AI Additional Terms of Service" (`policies.google.com/terms/generative-ai`) says of itself that it no longer applies since May 22, 2024, and Google's "Generative AI Prohibited Use Policy" has no rule about developing models.

Before each release, open every address again. Providers change their terms and move their pages. If another provider is added to the app, add its page here and in section 4.

Sections 6, 8 and 10 describe defaults that the owner can still change (data-model.md section 12, decisions 10 and 11; sync.md 15, decision 1; claude-api.md C14). When one changes, change the sentence here in the same commit.

What only the owner can settle before this text is final:

- The name of the person or company that operates the service, and a contact address. Neither is in this file.
- Who may use the service (a minimum age, countries).
- The law that governs the terms, and where disputes are heard.
- The wording on warranty and liability (section 11), which depends on that law. Draft 0.2 proposes wording there, to start from.
- For the Apple app, if it is ever given to other people: which licence text it uses. Sections 6 and 8 describe the web app; the Apple app keeps the vault and the key on the device.
- A privacy policy. It is a separate text and does not exist yet; web-platform.md 11.14 lists the facts it has to cover.

---

## Terms of use

Draft 0.2 of 2026-11-20. This is a draft, and no lawyer has read it. A sentence that begins with "Owner to decide" marks a point that the owner of this service has not settled yet.

### 1. This agreement, and what SessionVault is

These terms are an agreement between you and the operator of SessionVault ("we", "us"). Owner to decide: the operator's name. You agree to these terms when you create an account, and whenever you use SessionVault. If you do not agree to them, do not use it.

SessionVault ("the Service") is a personal vault for your own AI conversations. It keeps sessions that you had with an AI assistant, so that you still have the work you paid for after a session has ended or reached its limit. It also lets you carry the context of a saved session into a new conversation.

In these terms:

- "your vault" is everything you have saved in the Service;
- a "saved session" is one conversation in your vault;
- an "AI service" is any service whose conversations you save, such as Claude, ChatGPT or Gemini.

### 2. What a saved session contains

A saved session holds the text of the conversation as the page or the file showed it, as far as the Service could read it. The Service does not translate or transcribe the activity of sub-agents. A saved session can be missing the agents that took part and their subjects, the decisions and the work of red teams and blue teams, and other parts of a page. A saved session is therefore not a complete record of the work. Do not rely on it as one.

### 3. Whose conversations, and for what

- Save only conversations that are yours: conversations you took part in, from accounts that you are entitled to use.
- What you save remains yours. We claim no rights in it. You allow us to store it and to process it only as far as that is needed to provide the Service to you. That covers three things: keeping it on the hosting service that we use, which makes backup copies of its own (section 8); sending a saved session to Anthropic when you ask for that (section 6); and opening a link that you ask the Service to capture (section 7).
- Use what you save for your own work. Your vault is private: the Service has no shared vaults and no public links to a session, and no other user can see what you saved. You may not use the Service to pass on other people's conversations.
- You are responsible for what you save, and for having the right to save it.

### 4. The terms of the AI services your conversations come from

Each of your conversations was made under the terms of the AI service you used. Those terms can continue to apply to what you do with the text after you have saved it here. Nothing in these terms permits what the terms of an AI service forbid.

In particular, AI services restrict the use of their service, or of its output, to develop or train AI models. This is often called model distillation or model extraction. Each service publishes its rules on the pages listed below. Read the terms of the services you use. They change from time to time, and it is those terms that you agreed to, not this summary.

- **Anthropic (Claude).** The Usage Policy forbids using outputs to train an AI model, and names "model scraping" and "model distillation", unless Anthropic has authorized it beforehand: https://www.anthropic.com/legal/aup. See also the Consumer Terms of Service, section 3 (https://www.anthropic.com/legal/consumer-terms), and the Commercial Terms of Service, section D.4 (https://www.anthropic.com/legal/commercial-terms).
- **OpenAI (ChatGPT).** Terms of Use: https://openai.com/policies/row-terms-of-use/ (Europe: https://openai.com/policies/eu-terms-of-use/). For API and business customers, the OpenAI Services Agreement: https://openai.com/policies/services-agreement/. Read what they say about using Output to develop models.
- **Google (Gemini).** The Google Terms of Service forbid using AI-generated content from Google's services to develop machine learning models or related AI technology: https://policies.google.com/terms. For the Gemini API: the Gemini API Additional Terms of Service, https://ai.google.dev/gemini-api/terms.

If you save a conversation from any other service, read that service's terms in the same way.

### 5. Not for training or distilling models

You may not use the Service to collect the output of an AI model in order to train, fine-tune or distil an AI model, or to build a data set for that purpose. You may not help anyone else to use the Service in that way. The Service exists so that you can keep your own work and continue it. Reading a saved session, searching it, and giving its context to an assistant so that the work can go on are what it is for.

### 6. Your Claude API key

- "Continue with Claude" and "Summarize" use your own Anthropic API key. Anthropic bills the account that the key belongs to, and Anthropic's terms for that key apply to those requests.
- When you use either of them, the whole transcript of that saved session is sent to Anthropic through the Service, even if the session came from another AI service. You decide, session by session, whether to do that.
- Your key is stored encrypted on the Service. It is used only for your own requests, and it is never shown again. You can replace it, and you can remove it at any time. The operator of the Service is technically able to access the stored key.

### 7. Capturing a conversation from a link

Where the Service offers to fetch a conversation from a link, it opens public share links only. It never signs in to another service on your behalf. You can also import a conversation by pasting its text or by choosing a file. That does not depend on link capture. Capture only pages that you are allowed to save.

### 8. What is stored, and how you take it with you or remove it

- Your saved sessions are stored in your private vault on the Service. Unless you switch that off, they are also kept in an offline copy on each device where you are signed in. The offline copy is not encrypted: anyone who can use your browser on that device can read it. Signing out removes it.
- The operator of the Service is technically able to access what is stored in your vault.
- You can export one session, or your whole vault, while you are online.
- You can delete your account. Deleting it removes your account, your sessions, your projects and your stored API key from the Service. It does not remove: files that you exported or downloaded; the offline copy on your other devices, which each of them removes the next time it connects (changes that were never sent from a device stay there until you discard them); sessions in the SessionVault app on Apple devices; your key at Anthropic; and backup copies kept by the hosting service, which expire after a time.
- The privacy policy says what else is recorded and who processes it. Owner to decide: the privacy policy does not exist yet.

### 9. What you may not do

You may not:

- try to reach another user's vault, key or account, or test whether another account exists;
- use the Service to break the law or to infringe the rights of others;
- overload the Service on purpose, or get around its limits;
- use the Service to do what the terms of an AI service forbid (section 4), or to train or distil models (section 5).

### 10. Ending use

You can stop using the Service at any time by deleting your account. We may suspend or close an account that is used in a way that breaks these terms. A suspended user can still sign in, read and export the vault, and delete the account, but cannot add or change anything. Owner to decide: whether a user is told before an account is closed, and how long the user then has to export.

### 11. Warranty and liability

Owner to decide: the wording of this section, together with the law chosen in section 14. Proposed wording, until that is settled:

- The Service is provided as it is and as it is available. As far as the law allows, we give no warranty that it will be available without interruption, that it is free of errors, or that a saved session is complete or correct (section 2).
- As far as the law allows, we are not liable for loss of data, or for indirect or consequential loss, that results from using the Service or from not being able to use it. Owner to decide: whether these terms name an upper limit for any other liability, and which.
- Nothing in these terms limits a liability that the law does not allow to be limited, and nothing in them takes away a right that the law gives you as a consumer.

Whatever the final wording will be: the Service can change, be interrupted or end. Keep your own copies of what matters to you. The export exists for that.

### 12. Changes to these terms

We may change these terms. When they change, the Service shows the new version and asks you to agree again before you go on. The version you agreed to, and when you agreed, are recorded with your account. If you do not agree to a new version, you can still export your vault, delete your account and sign out.

### 13. Contact

Owner to decide: the contact address. It will be written in this section.

### 14. Who may use the Service, and which law applies

Owner to decide: who may use the Service (a minimum age, countries). Owner to decide: the law that governs these terms, and where disputes are heard.

### 15. General

- If a court finds that a part of these terms cannot be enforced, the rest of them stays in force.
- If we do not act on a breach of these terms at once, we keep the right to act on it later.
- These terms are the whole agreement between you and us about the Service. The privacy policy, once it exists, applies beside them.
