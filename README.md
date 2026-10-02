# my-harness (CodeForge)

Autonomous repository-aware coding-agent runtime and orchestration harness.

## Overview
`my-harness` is a local coding-agent runtime that takes a software task and a repository path, inspects the codebase, plans modifications, executes safe tools, applies targeted diff patches, runs tests, and verifies completion before halting.

## Features
- **Strict Sandboxing**: Working-directory containment (path jail), execution timeouts, and buffer truncation.
- **Structured Tools**: Rigid Zod schemas for all tool calls (`list_dir`, `read_file`, `apply_patch`, `run_command`, `git_diff`, `git_restore`).
- **Targeted Diff Patching**: Search-and-replace block replacement with fuzzy matching and atomic rollback.
- **Loop & Thrash Detection**: Fingerprint cycle detection to prevent infinite repetition.
- **Verification Gate**: Automated test and linter execution prior to declaring completion.
- **Telemetry**: Full JSON execution traces for benchmarking and evaluation.

## Setup & Running
```bash
# Clone the repository
git clone https://github.com/CYCLOTRON999/my-harness.git
cd my-harness

# Install dependencies
npm install

# Run the harness
npx tsx bin/codeforge.ts --task "Your task description" --repo "/path/to/target/repo"
```
