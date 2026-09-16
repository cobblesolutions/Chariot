import * as React from "react";

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * `text` with every occurrence of any term wrapped in <mark>. Terms are the
 * normalised list the API echoes back, so highlighting matches what matched.
 */
export function Highlight({
  text,
  terms,
  className,
}: {
  text: string;
  terms: readonly string[];
  className?: string;
}) {
  const pattern = React.useMemo(() => {
    const parts = terms.filter(Boolean).map(escapeRegExp);
    if (parts.length === 0) return null;
    // Longest first so "2026-09" wins over "20" when both are present.
    parts.sort((a, b) => b.length - a.length);
    return new RegExp(`(${parts.join("|")})`, "gi");
  }, [terms]);

  if (!pattern) return <span className={className}>{text}</span>;

  const lower = new Set(terms.map((term) => term.toLowerCase()));
  return (
    <span className={className}>
      {text.split(pattern).map((piece, index) =>
        lower.has(piece.toLowerCase()) ? (
          <mark
            key={index}
            className="rounded-[2px] bg-primary/15 px-px text-inherit"
          >
            {piece}
          </mark>
        ) : (
          <React.Fragment key={index}>{piece}</React.Fragment>
        ),
      )}
    </span>
  );
}
