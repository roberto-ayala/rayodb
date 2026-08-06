import { Ban, Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface ParsedError {
  code?: string;
  message: string;
  detail?: string;
  hint?: string;
}

/**
 * The backend hands the server's error over as one line. Split it back into
 * its parts so each reads as what it is instead of one run-on sentence.
 */
export function parseQueryError(raw: string): ParsedError {
  let rest = raw.replace(/^Query failed:\s*/i, "").trim();

  let code: string | undefined;
  const codeMatch = rest.match(/\s*\[([0-9A-Z]{5})\]\s*$/);
  if (codeMatch) {
    code = codeMatch[1];
    rest = rest.slice(0, codeMatch.index).trim();
  }

  let hint: string | undefined;
  const hintMatch = rest.match(/\s*\(hint:\s*([\s\S]*?)\)\s*$/);
  if (hintMatch) {
    hint = hintMatch[1].trim();
    rest = rest.slice(0, hintMatch.index).trim();
  }

  let detail: string | undefined;
  const detailIndex = rest.indexOf(" — ");
  if (detailIndex !== -1) {
    detail = rest.slice(detailIndex + 3).trim();
    rest = rest.slice(0, detailIndex).trim();
  }

  return { code, message: rest, detail, hint };
}

/**
 * A failed query reads as what the server printed — plain output on the panel
 * surface — not as an alert. Only the label carries the destructive colour.
 */
export function QueryErrorState({ error }: { error: { message: string; cancelled?: boolean } }) {
  const [copied, setCopied] = useState(false);
  const parsed = parseQueryError(error.message);

  const copy = () => {
    void navigator.clipboard.writeText(error.message);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (error.cancelled) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
        <Ban className="h-4 w-4" />
        Query cancelled
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="text-3xs font-semibold uppercase tracking-widest text-destructive">
          Error
        </span>
        {parsed.code && (
          <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-3xs text-muted-foreground">
            {parsed.code}
          </span>
        )}
        <div className="h-px flex-1 bg-border" />
        <Button variant="ghost" size="sm" onClick={copy}>
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      <pre className="mt-2 whitespace-pre-wrap font-mono text-code leading-relaxed text-foreground">
        {parsed.message}
      </pre>

      {(parsed.detail || parsed.hint) && (
        <dl className="mt-3 space-y-1.5">
          {parsed.detail && (
            <div className="flex gap-3">
              <dt className="w-12 shrink-0 pt-px text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
                Detail
              </dt>
              <dd className="whitespace-pre-wrap font-mono text-code text-muted-foreground">
                {parsed.detail}
              </dd>
            </div>
          )}
          {parsed.hint && (
            <div className="flex gap-3">
              <dt className="w-12 shrink-0 pt-px text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
                Hint
              </dt>
              <dd className="whitespace-pre-wrap font-mono text-code text-muted-foreground">
                {parsed.hint}
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
