import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import { OpenRouterClient } from "../provider/client.ts";
import { SandboxJail } from "../sandbox/jail.ts";
import { ProcessExecutor } from "../sandbox/executor.ts";
import { RollbackManager } from "../patch/rollback.ts";
import { allTools } from "../tools/index.ts";
import { AgentLoop } from "../engine/agent-loop.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");

export interface ServerOptions {
  port?: number;
  defaultRepo?: string;
  defaultModel?: string;
}

export function startUiServer(options: ServerOptions = {}): http.Server {
  const port = options.port ?? parseInt(process.env.PORT || "3333", 10);
  const envCandidates = [".env", path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "inductionharness/.env")];
  for (const file of envCandidates) {
    try {
      const content = fsSync.readFileSync(file, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
          if (!process.env[key]) process.env[key] = val;
        }
      }
      break;
    } catch {
      // Continue searching
    }
  }

  const defaultModel = options.defaultModel || process.env.OPENROUTER_MODEL || "deepseek/deepseek-chat";
  const defaultRepo = options.defaultRepo ? path.resolve(options.defaultRepo) : process.cwd();

  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;

    // Static HTML/CSS/JS route
    if ((req.method === "GET" || req.method === "HEAD") && (pathname === "/" || pathname === "/index.html")) {
      try {
        const html = await fs.readFile(path.join(PUBLIC_DIR, "index.html"), "utf-8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        res.end(html);
        return;
      } catch (err: unknown) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`Internal Server Error: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }

    // Config route
    if (req.method === "GET" && pathname === "/api/config") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          defaultRepo,
          defaultModel,
          hasApiKey: Boolean(process.env.OPENROUTER_API_KEY),
        })
      );
      return;
    }

    // Real-time execution stream route (SSE)
    if (req.method === "POST" && pathname === "/api/run") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });

      req.on("end", async () => {
        try {
          const payload = JSON.parse(body);
          const task = payload.task?.trim();
          const targetRepo = payload.repo?.trim() ? path.resolve(payload.repo.trim()) : defaultRepo;
          const model = payload.model?.trim() || defaultModel;
          const apiKey = payload.apiKey?.trim() || process.env.OPENROUTER_API_KEY;
          const sessionId = payload.sessionId?.trim() || undefined;
          const maxSteps = payload.maxSteps ? parseInt(payload.maxSteps, 10) : 15;

          if (!task) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Task description is required." }));
            return;
          }

          if (!apiKey) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "OpenRouter API Key not provided and OPENROUTER_API_KEY is unset." }));
            return;
          }

          // Setup SSE
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });

          const sendEvent = (event: string, data: unknown) => {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          };

          sendEvent("init", {
            task,
            repo: targetRepo,
            model,
            sessionId,
          });

          const sandbox = new SandboxJail(targetRepo);
          const executor = new ProcessExecutor(sandbox.getRoot());
          const rollback = new RollbackManager(sandbox, executor);
          const client = new OpenRouterClient({ apiKey, model });
          const loop = new AgentLoop(client, allTools, { sandbox, executor, rollback });

          const result = await loop.run({
            task,
            repoRoot: sandbox.getRoot(),
            maxSteps,
            resumeSessionId: sessionId,
            onTurn: (step, phase, detail) => {
              sendEvent("turn", { step, phase, detail });
            },
          });

          const modifiedFiles = rollback.getModifiedFiles();
          sendEvent("done", {
            status: result.status,
            stepCount: result.stepCount,
            durationMs: result.durationMs,
            totalTokens: result.totalTokens,
            summary: result.summary,
            tracePath: result.tracePath,
            sessionId: result.sessionId,
            modifiedFiles,
          });

          res.end();
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          res.write(`event: error\ndata: ${JSON.stringify({ error: errorMsg })}\n\n`);
          res.end();
        }
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
  });

  server.listen(port, () => {
    console.log(pc.bold(pc.cyan("\n=== CodeForge Web UI ===")));
    console.log(`Web interface listening at: ${pc.bold(pc.green(`http://localhost:${port}`))}`);
    console.log(`Target Repository: ${pc.dim(defaultRepo)}`);
    console.log(`Default Model: ${pc.dim(defaultModel)}\n`);
  });

  return server;
}

// CLI entrypoint if executed directly
if (process.argv[1] && process.argv[1].endsWith("server.ts")) {
  const repoArg = process.argv.find((_, i) => process.argv[i - 1] === "--repo" || process.argv[i - 1] === "-r");
  const portArg = process.argv.find((_, i) => process.argv[i - 1] === "--port" || process.argv[i - 1] === "-p");
  startUiServer({
    defaultRepo: repoArg,
    port: portArg ? parseInt(portArg, 10) : undefined,
  });
}
