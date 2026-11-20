// One message as it is drawn (docs/design.md 4.6.5 and 4.7). The text comes from other people's
// pages and files and is untrusted (4.7.3): every element here is built from the node lists of
// the display rules, text is always a text node, and a link exists only for an address that
// starts with http, https or mailto. Nothing named by a transcript is ever fetched.

import { isAttachmentSegment, isTextSegment, messageSegments, type VaultMessage } from "@sessionvault/core";
import { type InlineNode, parseInline, type RenderBlock, renderBlocks } from "@sessionvault/core/display";
import { memo, type ReactNode, useMemo } from "react";
import { isUserRole, roleName } from "../format.ts";
import { CopyButton } from "./controls.tsx";

/** design.md 4.7.3, rule 2, checked again where the element is made. */
const SAFE_ADDRESS = /^(?:https?:\/\/|mailto:)/i;

function inlineElements(nodes: readonly InlineNode[]): ReactNode[] {
  // The nodes come from immutable text and are never reordered, so their place is their identity.
  return nodes.map((node, index) => {
    const key = `${index}`;
    switch (node.type) {
      case "text":
        return node.text;
      case "code":
        return (
          <code key={key} className="inline-code">
            {node.text}
          </code>
        );
      case "link":
        return SAFE_ADDRESS.test(node.href) ? (
          <a key={key} href={node.href} target="_blank" rel="noopener noreferrer">
            {node.text}
          </a>
        ) : (
          node.text
        );
      case "strong":
        return <strong key={key}>{inlineElements(node.children)}</strong>;
      case "em":
        return <em key={key}>{inlineElements(node.children)}</em>;
      default:
        return <s key={key}>{inlineElements(node.children)}</s>;
    }
  });
}

function Prose({ block }: { block: Extract<RenderBlock, { type: "prose" }> }) {
  return (
    <div className="prose">
      {block.paragraphs.map((piece, index) => {
        const key = `${index}`;
        // A piece cut from the paragraph before it is drawn directly under it, as a plain block,
        // so that neither the look nor the copied text changes (4.7.4, rule 2).
        return piece.continues ? (
          <div key={key} className="prose__piece" dir="auto">
            {inlineElements(parseInline(piece.text))}
          </div>
        ) : (
          <p key={key} className="prose__paragraph" dir="auto">
            {inlineElements(parseInline(piece.text))}
          </p>
        );
      })}
    </div>
  );
}

function CodeBlock({
  block,
  onCopyFailed,
}: {
  block: Extract<RenderBlock, { type: "code" }>;
  onCopyFailed: () => void;
}) {
  return (
    <div className="code-block">
      <div className="code-block__header">
        <span className="code-block__language">{block.language ?? ""}</span>
        <CopyButton
          getText={() => block.code}
          label="Copy"
          copiedLabel="Copied"
          accessibleName="Copy code"
          variant="small"
          holdMs={1500}
          onFailed={onCopyFailed}
        />
      </div>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: the block scrolls sideways, so the keyboard must be able to reach it (design.md 4.6.5) */}
      <pre className="code-block__body" tabIndex={0}>
        <code>{block.code}</code>
      </pre>
    </div>
  );
}

/** The blocks of one text: prose and code, in order (design.md 4.7.1 and 4.7.4). */
export const TextBlocks = memo(function TextBlocks({
  text,
  onCopyFailed,
}: {
  text: string;
  onCopyFailed: () => void;
}) {
  const blocks = useMemo(() => renderBlocks(text), [text]);
  return (
    <>
      {blocks.map((block, index) => {
        const key = `${index}`;
        return block.type === "code" ? (
          <CodeBlock key={key} block={block} onCopyFailed={onCopyFailed} />
        ) : (
          <Prose key={key} block={block} />
        );
      })}
    </>
  );
});

/**
 * design.md 4.6.5: one message. The label shares a row with the Copy button, which copies the
 * text of the message whole and unchanged (web-platform.md 6.1, rule 5).
 */
export const MessageBubble = memo(function MessageBubble({
  message,
  onCopyFailed,
}: {
  message: VaultMessage;
  onCopyFailed: () => void;
}) {
  const segments = useMemo(() => messageSegments(message), [message]);
  return (
    <article className={isUserRole(message.role) ? "bubble bubble--user" : "bubble"}>
      <header className="bubble__header">
        <span className="bubble__role">{roleName(message.role)}</span>
        <CopyButton
          getText={() => message.text}
          label="Copy"
          copiedLabel="Copied"
          accessibleName="Copy message"
          variant="small"
          holdMs={1500}
          onFailed={onCopyFailed}
        />
      </header>
      {segments.map((segment, index) => {
        const key = `${index}`;
        if (isTextSegment(segment)) {
          return <TextBlocks key={key} text={segment.text} onCopyFailed={onCopyFailed} />;
        }
        return (
          <p key={key} className="bubble__unsupported">
            {isAttachmentSegment(segment)
              ? "Attachment (not shown in this version)"
              : `Unsupported content (${segment.type})`}
          </p>
        );
      })}
    </article>
  );
});
