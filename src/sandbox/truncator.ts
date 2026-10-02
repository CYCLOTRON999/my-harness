export interface TruncateOptions {
  maxLines?: number;
  maxChars?: number;
  headLines?: number;
  tailLines?: number;
}

export function truncateOutput(content: string, options: TruncateOptions = {}): string {
  const maxLines = options.maxLines ?? 45;
  const maxChars = options.maxChars ?? 2500;
  const headLines = options.headLines ?? 15;
  const tailLines = options.tailLines ?? 25;

  if (content.length <= maxChars) {
    const lines = content.split("\n");
    if (lines.length <= maxLines) {
      return content;
    }
  }

  const allLines = content.split("\n");
  if (allLines.length <= headLines + tailLines) {
    if (content.length > maxChars) {
      return content.slice(0, maxChars) + "\n[... truncated remaining text to save tokens ...]";
    }
    return content;
  }

  const head = allLines.slice(0, headLines).join("\n");
  const tail = allLines.slice(-tailLines).join("\n");
  const omitted = allLines.length - (headLines + tailLines);

  return `${head}\n\n[... truncated ${omitted} lines to preserve tokens and prevent rate limits ...]\n\n${tail}`;
}
