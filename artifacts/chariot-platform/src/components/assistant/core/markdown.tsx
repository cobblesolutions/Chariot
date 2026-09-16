import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { useAssistantConfig } from "./config";
import { linkEntities } from "./entities";
import type { Entity } from "./types";

const remarkPlugins = [remarkGfm];

/** Assistant replies: GitHub-flavoured markdown with every known record linked. */
function Markdown({
  children,
  entities = [],
  className,
}: {
  children: string;
  entities?: Entity[];
  className?: string;
}) {
  const { Link } = useAssistantConfig();
  const components = React.useMemo(
    () => ({
      // In-app paths use the host's router; everything else opens in a new tab.
      a: ({ href, children: label }: React.ComponentProps<"a">) =>
        href && href.startsWith("/") ? (
          <Link href={href}>{label}</Link>
        ) : (
          <a href={href} target="_blank" rel="noreferrer">
            {label}
          </a>
        ),
    }),
    [Link],
  );
  const source = React.useMemo(
    () => linkEntities(children, entities),
    [children, entities],
  );

  return (
    <div
      className={cn(
        "prose prose-sm max-w-none dark:prose-invert prose-p:my-1.5 prose-headings:my-2 prose-headings:text-sm prose-headings:font-semibold prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-table:my-2 prose-pre:my-2 prose-a:font-medium prose-a:text-primary prose-th:py-1 prose-td:py-1 [&>:first-child]:mt-0 [&>:last-child]:mb-0",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}

export { Markdown };
