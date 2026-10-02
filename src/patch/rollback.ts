import fs from "node:fs/promises";
import type { ProcessExecutor } from "../sandbox/executor.ts";
import type { SandboxJail } from "../sandbox/jail.ts";

export class RollbackManager {
  private readonly fileBackups = new Map<string, string>();
  private readonly modifiedFiles = new Set<string>();

  constructor(
    private readonly sandbox: SandboxJail,
    private readonly executor: ProcessExecutor
  ) {}

  public async snapshot(relPath: string): Promise<void> {
    const fullPath = this.sandbox.resolvePath(relPath);
    if (!this.fileBackups.has(relPath)) {
      try {
        const content = await fs.readFile(fullPath, "utf-8");
        this.fileBackups.set(relPath, content);
      } catch {
        // File does not exist yet (new file creation)
        this.fileBackups.set(relPath, "__NOT_EXISTS__");
      }
    }
    this.modifiedFiles.add(relPath);
  }

  public async rollbackFile(relPath: string): Promise<boolean> {
    const fullPath = this.sandbox.resolvePath(relPath);
    const backup = this.fileBackups.get(relPath);

    if (backup !== undefined) {
      if (backup === "__NOT_EXISTS__") {
        try {
          await fs.unlink(fullPath);
        } catch {
          // File might already be gone
        }
      } else {
        await fs.writeFile(fullPath, backup, "utf-8");
      }
      this.modifiedFiles.delete(relPath);
      return true;
    }

    // Fallback to Git restore
    const gitRes = await this.executor.execute(`git checkout -- "${relPath}" || git restore "${relPath}"`);
    return gitRes.exitCode === 0;
  }

  public async rollbackAll(): Promise<string[]> {
    const restored: string[] = [];
    for (const relPath of Array.from(this.modifiedFiles)) {
      const ok = await this.rollbackFile(relPath);
      if (ok) restored.push(relPath);
    }
    return restored;
  }

  public getModifiedFiles(): string[] {
    return Array.from(this.modifiedFiles);
  }
}
