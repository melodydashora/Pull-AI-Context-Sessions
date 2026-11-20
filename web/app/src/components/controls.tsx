// Small shared controls (docs/design.md 4.6.3, 4.6.6, 4.6.9). All visuals come from the tokens
// through static style sheets: no element here carries a style attribute.

import {
  Check,
  CircleCheck,
  CircleHelp,
  Copy,
  Diamond,
  Lightbulb,
  LoaderCircle,
  type LucideIcon,
  MessagesSquare,
  Sparkle,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { copyText } from "../clipboard.ts";
import { type ProviderId, providerName } from "../format.ts";

const PROVIDER_ICONS: Readonly<Record<ProviderId, LucideIcon>> = {
  claude: Sparkle,
  chatgpt: MessagesSquare,
  gemini: Diamond,
  other: CircleHelp,
};

/** The icon of a provider, in the provider's colour where the style sheet says so. */
export function ProviderIcon({ provider, size }: { provider: ProviderId; size: number }) {
  const Icon = PROVIDER_ICONS[provider];
  return <Icon size={size} aria-hidden="true" />;
}

/** design.md 4.6.3: icon and name on the provider's wash. Not interactive. */
export function ProviderChip({ provider }: { provider: ProviderId }) {
  return (
    <span className={`chip chip--${provider}`}>
      <ProviderIcon provider={provider} size={12} />
      {providerName(provider)}
    </span>
  );
}

/** A button that shows only an icon; `label` is its accessible name and its tooltip. */
export function IconButton({
  label,
  icon: Icon,
  onClick,
  disabled = false,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={20} aria-hidden="true" />
    </button>
  );
}

/**
 * A button that copies text and says so for a moment (design.md 4.6.4 and 4.6.5). The text is
 * taken when the button is pressed, and written inside that same click.
 */
export function CopyButton({
  getText,
  label,
  copiedLabel,
  accessibleName,
  variant,
  holdMs,
  onFailed,
}: {
  getText: () => string;
  label: string;
  copiedLabel: string;
  /** What assistive technology calls the button, when the visible label alone would not say what is copied. */
  accessibleName?: string;
  variant: "toolbar" | "small";
  holdMs: number;
  onFailed: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const onClick = (): void => {
    void copyText(getText()).then((ok) => {
      if (!alive.current) return;
      if (!ok) {
        onFailed();
        return;
      }
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), holdMs);
    });
  };

  const Icon = copied ? Check : Copy;
  return (
    <button
      type="button"
      className={variant === "toolbar" ? "button button--toolbar" : "copy-button"}
      aria-label={copied ? copiedLabel : (accessibleName ?? label)}
      title={accessibleName ?? label}
      onClick={onClick}
    >
      <Icon size={variant === "toolbar" ? 20 : 14} aria-hidden="true" />
      <span className="button__label" aria-live="polite">
        {copied ? copiedLabel : label}
      </span>
    </button>
  );
}

export interface Status {
  readonly kind: "success" | "warning" | "error" | "info" | "progress";
  readonly text: string;
  readonly action?: { readonly label: string; readonly run: () => void };
  /** Further sentences, one per line, under a "Details" disclosure. */
  readonly details?: readonly string[];
}

const STATUS_ICONS: Readonly<Record<Status["kind"], LucideIcon>> = {
  success: CircleCheck,
  warning: TriangleAlert,
  error: TriangleAlert,
  info: Lightbulb,
  progress: LoaderCircle,
};

/**
 * Each line with a key that is its text and how often that text came before it. Two files of one
 * import can have the same name and so the same line; the text alone is not a key.
 */
export function withOccurrence(lines: readonly string[]): { line: string; key: string }[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const n = seen.get(line) ?? 0;
    seen.set(line, n + 1);
    return { line, key: `${n}:${line}` };
  });
}

/** design.md 4.6.6: one status line with an icon by kind, wrapping text and an optional action. */
export function StatusNotice({ status }: { status: Status }) {
  const Icon = STATUS_ICONS[status.kind];
  return (
    <div className={`status status--${status.kind}`} role={status.kind === "error" ? "alert" : "status"}>
      <span className="status__icon">
        <Icon size={16} aria-hidden="true" />
      </span>
      <div className="status__body">
        <p className="status__text">{status.text}</p>
        {status.details !== undefined && status.details.length > 0 ? (
          <details className="status__details">
            <summary>Details</summary>
            <ul>
              {withOccurrence(status.details).map(({ line, key }) => (
                <li key={key}>{line}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      {status.action !== undefined ? (
        <button type="button" className="button button--plain" onClick={status.action.run}>
          {status.action.label}
        </button>
      ) : null}
    </div>
  );
}

/** design.md 4.6.3: a centred block for a list or a pane that has nothing to show. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <Icon size={40} strokeWidth={1.75} aria-hidden="true" className="empty__icon" />
      <h2 className="empty__title">{title}</h2>
      {description !== undefined ? <p className="empty__description">{description}</p> : null}
      {action ?? null}
    </div>
  );
}
