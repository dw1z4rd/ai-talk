export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function applyInline(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>");
}

export function formatMessage(raw: string): string {
  const text = escapeHtml(raw);
  const blocks = text.split(/\n{2,}/);

  return blocks
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";

      const lines = trimmed.split("\n");

      if (lines.every((l) => /^[-*•] /.test(l.trimStart()))) {
        const items = lines
          .map(
            (l) => `<li>${applyInline(l.replace(/^[-*•] /, "").trim())}</li>`,
          )
          .join("");
        return `<ul>${items}</ul>`;
      }

      if (lines.every((l) => /^\d+[.)]\s/.test(l.trimStart()))) {
        const items = lines
          .map(
            (l) =>
              `<li>${applyInline(l.replace(/^\d+[.)]\s/, "").trim())}</li>`,
          )
          .join("");
        return `<ol>${items}</ol>`;
      }

      return `<p>${lines.map(applyInline).join("<br>")}</p>`;
    })
    .filter(Boolean)
    .join("");
}
