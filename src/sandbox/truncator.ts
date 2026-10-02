export interface TruncateOptions {
  maxLines?: number;
  maxChars?: number;
  headLines?: number;
  tailLines?: number;
}

const NOISE_LINE_PATTERNS = [
  /^\s*npm\s+(notice|fund|warn\s+deprecated)/i,
  /^\s*\d+\s+packages\s+are\s+looking\s+for\s+funding/i,
  /^\s*run\s+`npm\s+fund`/i,
  /^\s*For\s+better\s+performance,\s+install\s+the\s+Watchdog\s+module/i,
  /^\s*\$\s*(xcode-select|pip\s+install\s+watchdog)/i,
];

const ERROR_INDICATOR_PATTERNS = [
  /\b(Error|Exception|AssertionError|TypeError|ReferenceError|SyntaxError)\b/i,
  /^\s*at\s+[\w.<>]+\s+\(/i,
  /^\s*File\s+"[^"]+",\s+line\s+\d+/i,
  /\b(FAIL|FAILED|Traceback\s+\(most\s+recent\s+call\s+last\))\b/i,
  /\b(Expected|Received|Diff):\b/i,
];

function isNoiseLine(line: string): boolean {
  return NOISE_LINE_PATTERNS.some((p) => p.test(line));
}

function isErrorLine(line: string): boolean {
  return ERROR_INDICATOR_PATTERNS.some((p) => p.test(line));
}

export function truncateOutput(content: string, options: TruncateOptions = {}): string {
  const maxLines = options.maxLines ?? 45;
  const maxChars = options.maxChars ?? 2500;
  const headLinesCount = options.headLines ?? 15;
  const tailLinesCount = options.tailLines ?? 25;

  if (content.length <= maxChars) {
    const rawLines = content.split("\n");
    if (rawLines.length <= maxLines) {
      return content;
    }
  }

  // 1. Strip useless noise lines to make room for critical information
  const rawLines = content.split("\n");
  const filteredLines: string[] = [];
  let prevEmpty = false;

  for (const line of rawLines) {
    if (isNoiseLine(line)) continue;
    const isEmpty = line.trim() === "";
    if (isEmpty && prevEmpty) continue; // Collapse redundant empty lines
    filteredLines.push(line);
    prevEmpty = isEmpty;
  }

  // If filtered lines fit within limits, return cleanly
  if (filteredLines.length <= headLinesCount + tailLinesCount) {
    const joined = filteredLines.join("\n");
    if (joined.length <= maxChars) {
      return joined;
    }
    return joined.slice(0, maxChars) + "\n[... truncated remaining text to save tokens ...]";
  }

  // 2. Scan middle section for critical error diagnostics
  const middleStart = headLinesCount;
  const middleEnd = filteredLines.length - tailLinesCount;
  const middleLines = filteredLines.slice(middleStart, middleEnd);

  let firstErrorIndexInMiddle = -1;
  for (let i = 0; i < middleLines.length; i++) {
    if (isErrorLine(middleLines[i])) {
      firstErrorIndexInMiddle = i;
      break;
    }
  }

  const head = filteredLines.slice(0, headLinesCount).join("\n");
  const tail = filteredLines.slice(-tailLinesCount).join("\n");

  if (firstErrorIndexInMiddle !== -1) {
    // Extract error block with surrounding context (3 lines before, 10 lines after)
    const errContextStart = Math.max(0, firstErrorIndexInMiddle - 3);
    const errContextEnd = Math.min(middleLines.length, firstErrorIndexInMiddle + 10);
    const errorBlock = middleLines.slice(errContextStart, errContextEnd).join("\n");

    const omittedBefore = errContextStart;
    const omittedAfter = middleLines.length - errContextEnd;

    let output = head;
    if (omittedBefore > 0) {
      output += `\n\n[... truncated ${omittedBefore} passing/intermediate lines ...]`;
    }
    output += `\n\n[--- CRITICAL ERROR DIAGNOSTICS ---]\n${errorBlock}\n[--- END ERROR DIAGNOSTICS ---]`;
    if (omittedAfter > 0) {
      output += `\n\n[... truncated ${omittedAfter} lines ...]`;
    }
    output += `\n\n${tail}`;

    if (output.length > maxChars) {
      return output.slice(0, maxChars) + "\n[... truncated to fit character limit ...]";
    }
    return output;
  }

  // Standard head + tail truncation when no isolated error block in middle
  const omitted = filteredLines.length - (headLinesCount + tailLinesCount);
  const result = `${head}\n\n[... truncated ${omitted} lines to preserve tokens and prevent rate limits ...]\n\n${tail}`;

  if (result.length > maxChars) {
    return result.slice(0, maxChars) + "\n[... truncated to fit character limit ...]";
  }
  return result;
}
