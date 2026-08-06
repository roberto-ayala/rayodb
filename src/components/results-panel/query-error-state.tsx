import { Ban, Check, Copy, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * A failed query is not a result set: it gets its own state rather than a
 * one-cell table, with the server's message kept verbatim and copyable.
 */
export function QueryErrorState({ error }: { error: { message: string; cancelled?: boolean } }) {
  const [copied, setCopied] = useState(false);

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
    <div className="flex-1 overflow-auto p-4">
      <div className="mx-auto max-w-3xl overflow-hidden rounded-lg border border-destructive/40 bg-destructive/5">
        <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-2">
          <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
          <span className="text-xs font-semibold text-destructive">Query failed</span>
          <Button variant="ghost" size="sm" onClick={copy} className="ml-auto">
            {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <pre className="whitespace-pre-wrap px-3 py-2.5 font-mono text-code leading-relaxed text-foreground">
          {error.message}
        </pre>
      </div>
    </div>
  );
}
