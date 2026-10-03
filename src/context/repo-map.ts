import fs from "node:fs/promises";
import path from "node:path";
import type { RankedFile } from "./selector.ts";

export interface SymbolEntry {
  line: number;
  kind: "function" | "class" | "interface" | "type" | "const";
  name: string;
  signature: string;
}

export interface FileOutline {
  relativePath: string;
  symbols: SymbolEntry[];
  lineCount: number;
}

const IGNORED_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".pnpm-store",
  ".DS_Store",
  "coverage",
]);

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".js",
  ".tsx",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".json",
  ".md",
]);

export class RepoMapper {
  constructor(private readonly repoRoot: string) {}

  public async getOutlines(maxFiles = 50): Promise<FileOutline[]> {
    const outlines: FileOutline[] = [];
    await this.scanDirectory(this.repoRoot, "", outlines, maxFiles);
    return outlines;
  }

  public async buildMap(maxFiles = 50): Promise<string> {
    const outlines = await this.getOutlines(maxFiles);

    if (outlines.length === 0) {
      return "[Repository is empty]";
    }

    const lines: string[] = ["=== Repository Architecture Map ==="];
    for (const outline of outlines) {
      lines.push(`${outline.relativePath} (${outline.lineCount} lines)`);
      for (const sym of outline.symbols) {
        lines.push(`  L${sym.line}: ${sym.kind} ${sym.name}`);
      }
    }

    return lines.join("\n");
  }

  public buildTargetedMap(outlines: FileOutline[], rankedFiles: RankedFile[], maxDetailed = 8): string {
    if (outlines.length === 0) {
      return "[Repository is empty]";
    }

    const rankedPaths = new Set(rankedFiles.slice(0, maxDetailed).map((r) => r.relativePath));
    const lines: string[] = ["=== Target Repository Context ==="];

    if (rankedFiles.length > 0) {
      lines.push("\nRelevant Files & Key Symbols (Priority):");
      for (const ranked of rankedFiles.slice(0, maxDetailed)) {
        const outline = outlines.find((o) => o.relativePath === ranked.relativePath);
        if (outline) {
          lines.push(`* ${outline.relativePath} (${outline.lineCount} lines)`);
          for (const sym of outline.symbols) {
            lines.push(`    L${sym.line}: ${sym.kind} ${sym.name}`);
          }
        }
      }
    }

    const otherFiles = outlines
      .filter((o) => !rankedPaths.has(o.relativePath))
      .map((o) => o.relativePath);

    if (otherFiles.length > 0) {
      lines.push("\nOther Repository Files:");
      for (const f of otherFiles.slice(0, 25)) {
        lines.push(`  ${f}`);
      }
      if (otherFiles.length > 25) {
        lines.push(`  [... ${otherFiles.length - 25} more files]`);
      }
    }

    return lines.join("\n");
  }

  private async scanDirectory(
    currentDir: string,
    relPrefix: string,
    outlines: FileOutline[],
    maxFiles: number
  ): Promise<void> {
    if (outlines.length >= maxFiles) return;

    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    // Sort entries: directories first, then files
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (IGNORED_NAMES.has(entry.name)) continue;

      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.join(relPrefix, entry.name);

      if (entry.isDirectory()) {
        await this.scanDirectory(fullPath, relPath, outlines, maxFiles);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (CODE_EXTENSIONS.has(ext)) {
          const outline = await this.extractFileOutline(fullPath, relPath);
          outlines.push(outline);
          if (outlines.length >= maxFiles) return;
        }
      }
    }
  }

  private async extractFileOutline(fullPath: string, relPath: string): Promise<FileOutline> {
    try {
      const content = await fs.readFile(fullPath, "utf-8");
      const lines = content.split("\n");
      const symbols: SymbolEntry[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const lineNum = i + 1;

        // Skip comments and empty lines
        if (!line || line.startsWith("//") || line.startsWith("#") || line.startsWith("/*")) {
          continue;
        }

        // Functions: export function name( | function name( | const name = (
        const fnMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/);
        if (fnMatch) {
          symbols.push({ line: lineNum, kind: "function", name: fnMatch[1], signature: line });
          continue;
        }

        // Classes: export class Name
        const classMatch = line.match(/(?:export\s+)?class\s+([a-zA-Z0-9_$]+)/);
        if (classMatch) {
          symbols.push({ line: lineNum, kind: "class", name: classMatch[1], signature: line });
          continue;
        }

        // Interfaces: export interface Name
        const ifaceMatch = line.match(/(?:export\s+)?interface\s+([a-zA-Z0-9_$]+)/);
        if (ifaceMatch) {
          symbols.push({ line: lineNum, kind: "interface", name: ifaceMatch[1], signature: line });
          continue;
        }

        // Python def / class
        const pyMatch = line.match(/^(?:async\s+)?def\s+([a-zA-Z0-9_]+)/);
        if (pyMatch) {
          symbols.push({ line: lineNum, kind: "function", name: pyMatch[1], signature: line });
          continue;
        }
        const pyClassMatch = line.match(/^class\s+([a-zA-Z0-9_]+)/);
        if (pyClassMatch) {
          symbols.push({ line: lineNum, kind: "class", name: pyClassMatch[1], signature: line });
          continue;
        }
      }

      return {
        relativePath: relPath,
        symbols,
        lineCount: lines.length,
      };
    } catch {
      return {
        relativePath: relPath,
        symbols: [],
        lineCount: 0,
      };
    }
  }
}
