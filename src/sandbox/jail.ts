import path from "node:path";
import fs from "node:fs";

export class SandboxSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxSecurityError";
  }
}

export class SandboxJail {
  private readonly rootPath: string;

  constructor(repoRoot: string) {
    this.rootPath = path.resolve(repoRoot);
    if (!fs.existsSync(this.rootPath)) {
      throw new SandboxSecurityError(`Repository path does not exist: ${this.rootPath}`);
    }
  }

  public getRoot(): string {
    return this.rootPath;
  }

  public resolvePath(targetPath: string): string {
    const resolved = path.resolve(this.rootPath, targetPath);
    if (!resolved.startsWith(this.rootPath)) {
      throw new SandboxSecurityError(
        `Access denied: path '${targetPath}' resolves outside repository root '${this.rootPath}'`
      );
    }

    if (fs.existsSync(resolved)) {
      try {
        const real = fs.realpathSync(resolved);
        if (!real.startsWith(this.rootPath)) {
          throw new SandboxSecurityError(
            `Access denied: symlink '${targetPath}' escapes repository root to '${real}'`
          );
        }
      } catch (err: unknown) {
        if (err instanceof SandboxSecurityError) throw err;
      }
    }

    return resolved;
  }
}
