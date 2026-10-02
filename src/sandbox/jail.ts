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
    const absPath = path.resolve(repoRoot);
    if (!fs.existsSync(absPath)) {
      throw new SandboxSecurityError(`Repository path does not exist: ${absPath}`);
    }
    // Resolve any OS symlinks (e.g. macOS /var -> /private/var) to canonical path
    this.rootPath = fs.realpathSync(absPath);
  }

  public getRoot(): string {
    return this.rootPath;
  }

  public resolvePath(targetPath: string): string {
    if (targetPath.includes("\0")) {
      throw new SandboxSecurityError("Access denied: path contains null bytes.");
    }

    const resolved = path.resolve(this.rootPath, targetPath);
    const relative = path.relative(this.rootPath, resolved);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new SandboxSecurityError(
        `Access denied: path '${targetPath}' resolves outside repository root '${this.rootPath}'`
      );
    }

    if (fs.existsSync(resolved)) {
      try {
        const real = fs.realpathSync(resolved);
        const realRelative = path.relative(this.rootPath, real);
        if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
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
