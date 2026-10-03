import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RepoMapper } from "../src/context/repo-map.ts";
import { ContextSelector } from "../src/context/selector.ts";

describe("RepoMapper & ContextSelector", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-context-test-"));

    // Seed mock repo
    await fs.writeFile(
      path.join(tempDir, "calculator.ts"),
      `// Calculator module
export function calculateTax(amount: number, rate: number): number {
  return amount * rate;
}

export class FinancialCalculator {
  discount(price: number): number {
    return price * 0.9;
  }
}
`
    );

    await fs.mkdir(path.join(tempDir, "utils"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "utils", "formatter.py"),
      `# Python helper
def format_currency(value):
    return f"\${value:.2f}"

class StringHelper:
    pass
`
    );

    // Create ignored folder
    await fs.mkdir(path.join(tempDir, "node_modules", "pkg"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "node_modules", "pkg", "index.js"),
      "function shouldIgnore() {}"
    );
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("RepoMapper should extract symbols and line counts across TS and Python files", async () => {
    const mapper = new RepoMapper(tempDir);
    const map = await mapper.buildMap();

    expect(map).toContain("=== Repository Architecture Map ===");
    expect(map).toContain("calculator.ts");
    expect(map).toContain("function calculateTax");
    expect(map).toContain("class FinancialCalculator");
    expect(map).toContain("utils/formatter.py");
    expect(map).toContain("function format_currency");
    expect(map).toContain("class StringHelper");
    expect(map).not.toContain("node_modules");
  });

  it("ContextSelector should rank relevant files higher based on task description", async () => {
    // Build map and extract outlines
    const outlines = [
      {
        relativePath: "calculator.ts",
        symbols: [
          { line: 2, kind: "function" as const, name: "calculateTax", signature: "function calculateTax" },
          { line: 6, kind: "class" as const, name: "FinancialCalculator", signature: "class FinancialCalculator" },
        ],
        lineCount: 12,
      },
      {
        relativePath: "utils/formatter.py",
        symbols: [
          { line: 2, kind: "function" as const, name: "format_currency", signature: "def format_currency" },
        ],
        lineCount: 8,
      },
    ];

    const selector = new ContextSelector();
    const ranked = selector.rankFiles("fix bug in calculateTax within calculator", outlines);

    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].relativePath).toBe("calculator.ts");
    expect(ranked[0].score).toBeGreaterThan(15);
    expect(ranked[0].matchedSymbols).toContain("function calculateTax");

    const mapper = new RepoMapper(tempDir);
    const targetedMap = mapper.buildTargetedMap(outlines, ranked, 1);
    expect(targetedMap).toContain("calculator.ts");
    expect(targetedMap).toContain("function calculateTax");
    expect(targetedMap).toContain("Other Repository Files:\n  utils/formatter.py");
  });
});
