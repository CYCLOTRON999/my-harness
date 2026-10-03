import pc from "picocolors";

export interface StatusCardMeta {
  repo: string;
  model: string;
  task?: string;
  sessionId?: string;
  testCmd?: string;
  streaming?: boolean;
}

export function renderCyberBanner(): void {
  const c = pc.cyan;
  const b = pc.blue;
  const w = (text: string) => pc.bold(pc.white(text));

  console.log("");
  console.log(b("  ╔═══[ ///// ]═══════════════════════════════════════════════════════[ ///// ]═══╗"));
  console.log(b("  ║") + c("  +  :                                                           :  +  ") + b("║"));
  console.log(b("  ║") + "             " + w("██████╗██╗      █████╗ ██╗    ██╗") + "             " + b("║"));
  console.log(b("  ║") + "            " + w("██╔════╝██║     ██╔══██╗██║    ██║") + "            " + b("║"));
  console.log(b("  ║") + "            " + c("██║     ██║     ███████║██║ █╗ ██║") + "            " + b("║"));
  console.log(b("  ║") + "            " + c("██║     ██║     ██╔══██║██║███╗██║") + "            " + b("║"));
  console.log(b("  ║") + "            " + b("╚██████╗███████╗██║  ██║╚███╔███╔╝") + "            " + b("║"));
  console.log(b("  ║") + "             " + b("╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝ ") + "             " + b("║"));
  console.log(b("  ║") + "    " + w("██╗  ██╗ █████╗ ██████╗ ███╗   ██╗███████╗███████╗") + "    " + b("║"));
  console.log(b("  ║") + "    " + w("██║  ██║██╔══██╗██╔══██╗████╗  ██║██╔════╝██╔════╝") + "    " + b("║"));
  console.log(b("  ║") + "    " + c("███████║███████║██████╔╝██╔██╗ ██║█████╗  ███████╗") + "    " + b("║"));
  console.log(b("  ║") + "    " + c("██╔══██║██╔══██║██╔══██╗██║╚██╗██║██╔══╝  ╚════██║") + "    " + b("║"));
  console.log(b("  ║") + "    " + b("██║  ██║██║  ██║██║  ██║██║ ╚████║███████╗███████║") + "    " + b("║"));
  console.log(b("  ║") + "    " + b("╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝") + "    " + b("║"));
  console.log(b("  ║") + c("  +  :                                                           :  +  ") + b("║"));
  console.log(b("  ╚═══════════════[ ") + c("AUTONOMOUS CODING AGENT // v0.2.0") + b(" ]════════════════╝"));
  console.log("");
}

export function renderStatusCard(meta: StatusCardMeta): void {
  const dim = pc.dim;
  const cyan = pc.cyan;
  const green = pc.green;
  const yellow = pc.yellow;
  const magenta = pc.magenta;

  const width = 77;
  const hr = "─".repeat(width);

  console.log(dim(`  ╭${hr}╮`));

  const printRow = (label: string, value: string) => {
    const rawLen = label.length + 3 + stripAnsi(value).length;
    const padding = Math.max(0, width - rawLen - 2);
    console.log(`  ${dim("│")}  ${cyan(label.padEnd(14))} ${value}${" ".repeat(padding)}${dim("│")}`);
  };

  printRow("Repository", green(meta.repo));
  printRow("Model", yellow(meta.model));

  if (meta.task) {
    const truncatedTask = meta.task.length > 55 ? `${meta.task.slice(0, 52)}...` : meta.task;
    printRow("Task", pc.white(truncatedTask));
  }

  if (meta.sessionId) {
    printRow("Session ID", magenta(meta.sessionId));
  }

  if (meta.testCmd) {
    printRow("Test Command", pc.blue(meta.testCmd));
  }

  printRow("Runtime", `${dim("Sandbox Jail")} • ${dim("Real-time SSE")} • ${dim("Turn-2 Compaction")}`);
  printRow("Tools Active", dim("file, grep, read, patch, write, test, git (10 tools)"));

  console.log(dim(`  ╰${hr}╯`));
  console.log("");
}

export function renderTurnDetail(phase: string, detail: string): void {
  if (phase === "PLAN") {
    if (detail === "Consulting model...") return;
    console.log(`  ${pc.blue("[PLAN]")} ${detail}`);
    return;
  }

  if (phase === "THINK") {
    const lines = detail.trim().split("\n").filter(Boolean);
    const preview = lines.slice(0, 2).join(" ");
    const truncated = preview.length > 100 ? `${preview.slice(0, 97)}...` : preview;
    console.log(`  ${pc.magenta("[THINK]")} ${pc.dim(truncated)}`);
    return;
  }

  if (phase === "ACT") {
    let actDisplay = detail;
    const match = detail.match(/^(\w+)\((.*)\)$/s);
    if (match) {
      const fn = match[1];
      try {
        const args = JSON.parse(match[2]) as Record<string, unknown>;
        if (fn === "read_file") {
          const range = args.start_line ? `:${args.start_line}-${args.end_line ?? ""}` : "";
          actDisplay = `read_file(${args.path}${range})`;
        } else if (fn === "list_dir") {
          actDisplay = `list_dir(${args.path || "."})`;
        } else if (fn === "grep_search") {
          actDisplay = `grep_search("${args.query}" in ${args.path || "."})`;
        } else if (fn === "file_search") {
          actDisplay = `file_search("${args.pattern}")`;
        } else if (fn === "apply_patch") {
          actDisplay = `apply_patch(${args.path})`;
        } else if (fn === "write_file") {
          actDisplay = `write_file(${args.path})`;
        } else if (fn === "run_command") {
          actDisplay = `run_command("${args.command}")`;
        } else if (fn === "git_status") {
          actDisplay = `git_status()`;
        } else if (fn === "git_diff") {
          actDisplay = `git_diff()`;
        }
      } catch {
        // Fallback to raw detail
      }
    }
    console.log(`  ${pc.yellow("[ACT]")} ${pc.bold(actDisplay)}`);
    return;
  }

  if (phase === "OBSERVE") {
    // Unified diff
    if (detail.includes("--- ") || detail.includes("+++ ")) {
      const colored = detail
        .split("\n")
        .slice(0, 15)
        .map((line) => {
          if (line.startsWith("+") && !line.startsWith("+++")) return pc.green(line);
          if (line.startsWith("-") && !line.startsWith("---")) return pc.red(line);
          return pc.dim(line);
        })
        .join("\n    ");
      console.log(`  ${pc.green("[OBSERVE]")} Patch diff:\n    ${colored}`);
      return;
    }

    // Read file summary
    const readMatch = detail.match(/Showing lines (\d+)-(\d+) of (\d+) in '([^']+)'/);
    if (readMatch) {
      console.log(
        `  ${pc.dim("[OBSERVE]")} Read lines ${readMatch[1]}-${readMatch[2]} of ${readMatch[3]} in '${pc.cyan(readMatch[4])}'`
      );
      return;
    }

    // List dir summary
    if (detail.startsWith("Contents of '")) {
      const count = detail.split("\n").filter((l) => l.startsWith("[dir]") || l.startsWith("[file]")).length;
      const pathMatch = detail.match(/Contents of '([^']*)':/);
      const p = pathMatch ? pathMatch[1] : ".";
      console.log(`  ${pc.dim("[OBSERVE]")} ${count} entries found in '${pc.cyan(p)}'`);
      return;
    }

    // Grep search summary
    if (detail.startsWith("No matches found")) {
      console.log(`  ${pc.dim("[OBSERVE]")} No matches found`);
      return;
    }
    if (detail.includes("Found ") && (detail.includes(" matches") || detail.includes(" matching line"))) {
      const firstLine = detail.split("\n")[0];
      console.log(`  ${pc.dim("[OBSERVE]")} ${firstLine}`);
      return;
    }

    // Command output
    if (detail.includes("exit code 0")) {
      console.log(`  ${pc.green("[OBSERVE]")} Command succeeded (exit code 0)`);
      return;
    }

    // Error or notice
    if (detail.startsWith("Error") || detail.startsWith("Tool execution error")) {
      console.log(`  ${pc.red("[OBSERVE]")} ${detail.split("\n")[0]}`);
      return;
    }

    if (detail.startsWith("[Notice:")) {
      console.log(`  ${pc.yellow("[OBSERVE]")} ${detail.split("\n")[0]}`);
      return;
    }

    // Default compact observation
    const firstLine = detail.trim().split("\n")[0];
    const preview = firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
    console.log(`  ${pc.dim("[OBSERVE]")} ${preview}`);
    return;
  }

  if (phase === "STOP") {
    console.log(pc.bold(pc.green("\n  === Response ===")));
    console.log(`  ${detail.trim().split("\n").join("\n  ")}\n`);
    return;
  }

  console.log(`  ${pc.dim(`[${phase}]`)} ${detail}`);
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[\d+m/g, "");
}
