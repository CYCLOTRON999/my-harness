export interface PatchResult {
  success: boolean;
  patchedContent?: string;
  error?: string;
  fuzzyMatchUsed?: boolean;
}

export function normalizeLineEndings(text: string): { normalized: string; isCrlf: boolean } {
  const isCrlf = text.includes("\r\n");
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return { normalized, isCrlf };
}

export function normalizeForFuzzyMatch(text: string): string {
  return text
    .normalize("NFKC")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'") // Smart single quotes
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"') // Smart double quotes
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-") // Unicode hyphens and dashes
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " "); // Special whitespace
}

export function applyTargetedPatch(
  originalContent: string,
  searchBlock: string,
  replaceBlock: string
): PatchResult {
  const { normalized: contentLF, isCrlf } = normalizeLineEndings(originalContent);
  const { normalized: searchLF } = normalizeLineEndings(searchBlock);
  const { normalized: replaceLF } = normalizeLineEndings(replaceBlock);

  if (!searchLF.trim()) {
    return { success: false, error: "search_block cannot be empty." };
  }

  // 1. Attempt exact match
  const exactCount = contentLF.split(searchLF).length - 1;
  if (exactCount === 1) {
    const updatedLF = contentLF.replace(searchLF, replaceLF);
    const finalContent = isCrlf ? updatedLF.replace(/\n/g, "\r\n") : updatedLF;
    return { success: true, patchedContent: finalContent, fuzzyMatchUsed: false };
  }

  if (exactCount > 1) {
    return {
      success: false,
      error: `search_block matches ${exactCount} locations in file. Provide more surrounding context lines to make it unique.`,
    };
  }

  // 2. Attempt progressive fuzzy match
  const fuzzyContent = normalizeForFuzzyMatch(contentLF);
  const fuzzySearch = normalizeForFuzzyMatch(searchLF);

  const fuzzyCount = fuzzyContent.split(fuzzySearch).length - 1;
  if (fuzzyCount === 0) {
    return {
      success: false,
      error: "search_block was not found in target file. Check current file contents using read_file.",
    };
  }

  if (fuzzyCount > 1) {
    return {
      success: false,
      error: `search_block matches ${fuzzyCount} locations under fuzzy whitespace matching. Provide more surrounding lines.`,
    };
  }

  // Locate the line index where fuzzy match starts
  const searchLines = fuzzySearch.split("\n");
  const contentLines = contentLF.split("\n");
  let matchedLineIdx = -1;

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    let match = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (normalizeForFuzzyMatch(contentLines[i + j]) !== searchLines[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      matchedLineIdx = i;
      break;
    }
  }

  if (matchedLineIdx === -1) {
    return {
      success: false,
      error: "Unable to align fuzzy match with original line boundaries.",
    };
  }

  const before = contentLines.slice(0, matchedLineIdx);
  const after = contentLines.slice(matchedLineIdx + searchLines.length);
  const newLines = [...before, ...replaceLF.split("\n"), ...after];
  const updatedLF = newLines.join("\n");
  const finalContent = isCrlf ? updatedLF.replace(/\n/g, "\r\n") : updatedLF;

  return { success: true, patchedContent: finalContent, fuzzyMatchUsed: true };
}
