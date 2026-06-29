import type { CSSProperties } from "react";

interface MarkdownContentProps {
  content: string;
  className?: string;
  style?: CSSProperties;
}

export function MarkdownContent({ content, className = "", style }: MarkdownContentProps) {
  return (
    <div
      className={`rounded-md bg-muted border border-border p-3.5 text-xs text-card-foreground max-h-[400px] overflow-y-auto leading-relaxed [&_h1]:text-base [&_h1]:font-bold [&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-card-foreground [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-card-foreground [&_h3]:text-xs [&_h3]:font-bold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-card-foreground [&_p]:mb-2 [&_p]:last:mb-0 [&_strong]:font-semibold [&_em]:italic [&_code]:font-mono [&_code]:bg-card [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_pre]:bg-card [&_pre]:border [&_pre]:border-border [&_pre]:rounded [&_pre]:p-3 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-2 [&_li]:mb-0.5 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground [&_blockquote]:my-2 ${className}`}
      style={style}
      dangerouslySetInnerHTML={{ __html: simpleMarkdown(content) }}
    />
  );
}

function simpleMarkdown(md: string): string {
  let html = md;

  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, url) => {
    const safeUrl = /^\s*(https?:\/\/|\/|#)/i.test(url) ? url : "#";
    return `<a href="${escapeHtmlAttribute(safeUrl.trim())}" target="_blank" rel="noopener">${text}</a>`;
  });

  html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");
  html = html.replace(/^[-*] (.+)$/gm, "<li data-list=\"ul\">$1</li>");
  html = html.replace(/^\d+\. (.+)$/gm, "<li data-list=\"ol\">$1</li>");
  html = wrapListBlocks(html, "ul");
  html = wrapListBlocks(html, "ol");
  html = html.replace(/\n\n/g, "</p><p>");
  html = `<p>${html}</p>`;

  html = html.replace(
    /(?<!<\/?(p|h[1-3]|ul|ol|li|pre|blockquote)>)\n/g,
    "<br>",
  );

  html = html.replace(/<p>\s*<\/p>/g, "");
  html = html.replace(/<p>\s*(<(?:h[1-3]|ul|ol|pre|blockquote))/g, "$1");
  html = html.replace(
    /(<\/(?:h[1-3]|ul|ol|pre|blockquote)>)\s*<\/p>/g,
    "$1",
  );

  return html;
}

function wrapListBlocks(html: string, listTag: "ul" | "ol"): string {
  const marker = `data-list="${listTag}"`;
  return html.replace(
    new RegExp(`((?:<li ${marker}>.*<\\/li>\\n?)+)`, "g"),
    (_match, items) => `<${listTag}>${items.replaceAll(` ${marker}`, "")}</${listTag}>`,
  );
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
