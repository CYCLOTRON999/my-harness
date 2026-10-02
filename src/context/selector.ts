import path from "node:path";
import type { FileOutline } from "./repo-map.ts";

export interface RankedFile {
  relativePath: string;
  score: number;
  matchedSymbols: string[];
}

export class ContextSelector {
  public rankFiles(taskDescription: string, outlines: FileOutline[]): RankedFile[] {
    const rawTokens = taskDescription
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((t) => t.length > 2);

    const stopWords = new Set(["the", "and", "for", "with", "this", "that", "from", "when", "does", "not"]);
    const taskTokens = rawTokens.filter((t) => !stopWords.has(t));

    const ranked: RankedFile[] = [];

    for (const outline of outlines) {
      let score = 0;
      const matchedSymbols: string[] = [];
      const fileNameLower = path.basename(outline.relativePath).toLowerCase();
      const pathLower = outline.relativePath.toLowerCase();

      for (const token of taskTokens) {
        // Direct filename match is highest signal
        if (fileNameLower.includes(token)) {
          score += 10;
        } else if (pathLower.includes(token)) {
          score += 4;
        }

        // Symbol name matches
        for (const sym of outline.symbols) {
          if (sym.name.toLowerCase().includes(token)) {
            score += 6;
            matchedSymbols.push(`${sym.kind} ${sym.name}`);
          }
        }
      }

      // If test file matches task test requirements
      if (pathLower.includes("test") && (taskTokens.includes("test") || taskTokens.includes("tests"))) {
        score += 3;
      }

      if (score > 0) {
        ranked.push({
          relativePath: outline.relativePath,
          score,
          matchedSymbols,
        });
      }
    }

    return ranked.sort((a, b) => b.score - a.score);
  }
}
