import os
from PIL import Image, ImageDraw, ImageFont

ASSETS_DIR = "/Users/abhaysingh/Downloads/pi-main/inductionharness/assets"
os.makedirs(ASSETS_DIR, exist_ok=True)

FONT_PATH = "/System/Library/Fonts/Menlo.ttc"
FONT_SIZE = 14
LINE_HEIGHT = 20

def create_terminal_image(title: str, lines: list, output_filename: str, width: int = 880):
    font = ImageFont.truetype(FONT_PATH, FONT_SIZE)
    bold_font = ImageFont.truetype(FONT_PATH, FONT_SIZE)
    title_font = ImageFont.truetype(FONT_PATH, 12)
    
    header_height = 42
    padding = 24
    content_height = len(lines) * LINE_HEIGHT + padding * 2
    height = header_height + content_height
    
    img = Image.new("RGBA", (width, height), (13, 17, 23, 255))
    draw = ImageDraw.Draw(img)
    
    # Outer border
    draw.rectangle([(0, 0), (width - 1, height - 1)], outline=(48, 54, 61, 255), width=1)
    
    # Window Header
    draw.rectangle([(1, 1), (width - 2, header_height)], fill=(22, 27, 34, 255))
    draw.line([(1, header_height), (width - 2, header_height)], fill=(48, 54, 61, 255), width=1)
    
    # Traffic lights
    draw.ellipse([(16, 15), (28, 27)], fill=(255, 95, 87, 255))   # Red
    draw.ellipse([(36, 15), (48, 27)], fill=(254, 188, 46, 255))  # Yellow
    draw.ellipse([(56, 15), (68, 27)], fill=(40, 200, 64, 255))   # Green
    
    # Window Title
    title_bbox = draw.textbbox((0, 0), title, font=title_font)
    title_w = title_bbox[2] - title_bbox[0]
    draw.text(((width - title_w) // 2, 14), title, font=title_font, fill=(139, 148, 158, 255))
    
    # Content lines
    y = header_height + padding
    for line in lines:
        x = padding
        if isinstance(line, (list, tuple)) and len(line) > 0 and isinstance(line[0], (list, tuple)):
            # Line is a list of spans: [(text, color), (text, color), ...]
            for span in line:
                span_text, span_color = span[0], span[1]
                draw.text((x, y), span_text, font=font, fill=span_color)
                bbox = draw.textbbox((x, y), span_text, font=font)
                x += bbox[2] - bbox[0]
        elif isinstance(line, str):
            draw.text((x, y), line, font=font, fill=(201, 209, 217, 255))
        y += LINE_HEIGHT
        
    out_path = os.path.join(ASSETS_DIR, output_filename)
    img.save(out_path, "PNG")
    print(f"Generated: {out_path}")

# Colors
C_WHITE = (240, 246, 252, 255)
C_DIM = (110, 118, 129, 255)
C_CYAN = (88, 166, 255, 255)
C_BLUE = (88, 166, 255, 255)
C_GREEN = (63, 185, 80, 255)
C_YELLOW = (210, 153, 34, 255)
C_MAGENTA = (188, 140, 255, 255)
C_RED = (248, 81, 73, 255)

# Screenshot 1: REPL & Cyber Banner
lines_1 = [
    ([("  ╔═══[ ///// ]═══════════════════════════════════════════════════════[ ///// ]═══╗", C_BLUE)],),
    ([("  ║", C_BLUE), ("  +  :                                                           :  +  ", C_CYAN), ("║", C_BLUE)],),
    ([("  ║", C_BLUE), ("             ██████╗██╗      █████╗ ██╗    ██╗             ", C_WHITE), ("║", C_BLUE)],),
    ([("  ║", C_BLUE), ("            ██╔════╝██║     ██╔══██╗██║    ██║            ", C_WHITE), ("║", C_BLUE)],),
    ([("  ║", C_BLUE), ("            ██║     ██║     ███████║██║ █╗ ██║            ", C_CYAN), ("║", C_BLUE)],),
    ([("  ║", C_BLUE), ("            ██║     ██║     ██╔══██║██║███╗██║            ", C_CYAN), ("║", C_BLUE)],),
    ([("  ║", C_BLUE), ("            ╚██████╗███████╗██║  ██║╚███╔███╔╝            ", C_BLUE), ("║", C_BLUE)],),
    ([("  ║", C_BLUE), ("    ██╗  ██╗ █████╗ ██████╗ ███╗   ██╗███████╗███████╗    ", C_WHITE), ("║", C_BLUE)],),
    ([("  ║", C_BLUE), ("    ██║  ██║██╔══██╗██╔══██╗████╗  ██║██╔════╝██╔════╝    ", C_WHITE), ("║", C_BLUE)],),
    ([("  ║", C_BLUE), ("    ███████║███████║██████╔╝██╔██╗ ██║█████╗  ███████╗    ", C_CYAN), ("║", C_BLUE)],),
    ([("  ║", C_BLUE), ("    ██╔══██║██╔══██║██╔══██╗██║╚██╗██║██╔══╝  ╚════██║    ", C_CYAN), ("║", C_BLUE)],),
    ([("  ║", C_BLUE), ("    ██║  ██║██║  ██║██║  ██║██║ ╚████║███████╗███████║    ", C_BLUE), ("║", C_BLUE)],),
    ([("  ║", C_BLUE), ("  +  :                                                           :  +  ", C_CYAN), ("║", C_BLUE)],),
    ([("  ╚═══════════════[ ", C_BLUE), ("AUTONOMOUS CODING AGENT // v0.2.0", C_CYAN), (" ]════════════════╝", C_BLUE)],),
    ([("", C_WHITE)],),
    ([("  ╭─────────────────────────────────────────────────────────────────────────────╮", C_DIM)],),
    ([("  │  ", C_DIM), ("Repository    ", C_CYAN), ("/Users/abhaysingh/Downloads/pi-main/inductionharness            ", C_GREEN), ("│", C_DIM)],),
    ([("  │  ", C_DIM), ("Model         ", C_CYAN), ("deepseek/deepseek-chat (OpenRouter + Gemini Fallback)       ", C_YELLOW), ("│", C_DIM)],),
    ([("  │  ", C_DIM), ("Runtime       ", C_CYAN), ("Sandbox Jail • Real-time SSE • Turn-2 Compaction            ", C_DIM), ("│", C_DIM)],),
    ([("  │  ", C_DIM), ("Tools Active  ", C_CYAN), ("file, grep, read, patch, write, test, git (10 tools)        ", C_DIM), ("│", C_DIM)],),
    ([("  ╰─────────────────────────────────────────────────────────────────────────────╯", C_DIM)],),
    ([("", C_WHITE)],),
    ([("  Commands: ", C_DIM), ("/help", C_CYAN), (" • ", C_DIM), ("/status", C_CYAN), (" • ", C_DIM), ("/diff", C_CYAN), (" • ", C_DIM), ("/rollback", C_CYAN), (" • ", C_DIM), ("/clear", C_CYAN), (" • ", C_DIM), ("/exit", C_CYAN)],),
    ([("", C_WHITE)],),
    ([("claw ❯ ", C_GREEN), ("fix parameter parsing issue when query string contains repeated keys", C_WHITE)],),
]

# Screenshot 2: Live FSM Execution
lines_2 = [
    ([("claw ❯ ", C_GREEN), ("fix parameter parsing issue in router.ts", C_WHITE)],),
    ([("", C_WHITE)],),
    ([("Step 1", C_DIM)],),
    ([("  [PLAN] ", C_BLUE), ("Analyzing repository structure and locating parameter parser", C_WHITE)],),
    ([("  [THINK] ", C_MAGENTA), ("We need to find where query strings are extracted and decoded...", C_DIM)],),
    ([("  [ACT] ", C_YELLOW), ("grep_search(\"parseQueryParams\" in src/router.ts)", C_WHITE)],),
    ([("  [OBSERVE] ", C_DIM), ("Found 2 matches in 'src/router.ts': lines 42 and 89", C_DIM)],),
    ([("", C_WHITE)],),
    ([("Step 2", C_DIM)],),
    ([("  [PLAN] ", C_BLUE), ("Reading handler implementation lines 40-70", C_WHITE)],),
    ([("  [ACT] ", C_YELLOW), ("read_file(src/router.ts:40-70)", C_WHITE)],),
    ([("  [OBSERVE] ", C_DIM), ("Read lines 40-70 of 145 in 'src/router.ts'", C_DIM)],),
    ([("", C_WHITE)],),
    ([("Step 3", C_DIM)],),
    ([("  [PLAN] ", C_BLUE), ("Applying targeted search-and-replace block patch to router.ts", C_WHITE)],),
    ([("  [ACT] ", C_YELLOW), ("apply_patch(src/router.ts)", C_WHITE)],),
    ([("  [OBSERVE] ", C_GREEN), ("Patch applied cleanly. Snapshot created for atomic rollback.", C_GREEN)],),
    ([("", C_WHITE)],),
    ([("Step 4", C_DIM)],),
    ([("  [PLAN] ", C_BLUE), ("Code modified. Triggering Mandatory Verification Gate...", C_WHITE)],),
    ([("  [ACT] ", C_YELLOW), ("run_command(\"npm test\")", C_WHITE)],),
    ([("  [OBSERVE] ", C_GREEN), ("Command succeeded (exit code 0)", C_GREEN)],),
]

# Screenshot 3: Colored Diff
lines_3 = [
    ([("claw ❯ ", C_GREEN), ("/diff", C_CYAN)],),
    ([("", C_WHITE)],),
    ([("diff --git a/src/router.ts b/src/router.ts", C_WHITE)],),
    ([("index 4b825dc..91a03ef 100644", C_DIM)],),
    ([("--- a/src/router.ts", C_RED)],),
    ([("+++ b/src/router.ts", C_GREEN)],),
    ([("@@ -48,7 +48,11 @@ export function parseQueryParams(queryStr: string): Record<string, string> {", C_CYAN)],),
    ([("   if (!queryStr) return {};", C_DIM)],),
    ([(" ", C_DIM)],),
    ([("-  return Object.fromEntries(queryStr.split(\"&\").map(kv => kv.split(\"=\")));", C_RED)],),
    ([("+  const params = new URLSearchParams(queryStr);", C_GREEN)],),
    ([("+  const result: Record<string, string> = {};", C_GREEN)],),
    ([("+  for (const [key, value] of params.entries()) {", C_GREEN)],),
    ([("+    result[key] = decodeURIComponent(value);", C_GREEN)],),
    ([("+  }", C_GREEN)],),
    ([("+  return result;", C_GREEN)],),
    ([(" }", C_DIM)],),
    ([("", C_WHITE)],),
    ([("  Status: 1 file modified (+6, -1 lines). Atomic snapshot ready.", C_YELLOW)],),
]

# Screenshot 4: Verification Gate
lines_4 = [
    ([("  [ACT] ", C_YELLOW), ("run_command(\"npm test\")", C_WHITE)],),
    ([("  [OBSERVE] ", C_GREEN), ("Command succeeded (exit code 0)", C_GREEN)],),
    ([("    ✓ test/router.test.ts (12 tests passed)", C_GREEN)],),
    ([("    ✓ test/query.test.ts (8 tests passed)", C_GREEN)],),
    ([("    ✓ test/security.test.ts (6 tests passed)", C_GREEN)],),
    ([("", C_WHITE)],),
    ([("    Test Files  3 passed (3)", C_GREEN)],),
    ([("         Tests  26 passed (26)", C_GREEN)],),
    ([("      Duration  412ms", C_DIM)],),
    ([("", C_WHITE)],),
    ([("  === Response ===", C_GREEN)],),
    ([("  Successfully resolved parameter parsing edge case in 'src/router.ts'.", C_WHITE)],),
    ([("  Enforced URLSearchParams decode with support for ampersands and URI encodings.", C_WHITE)],),
    ([("  Mandatory Verification Gate passed: 26/26 unit tests succeeded with exit code 0.", C_GREEN)],),
    ([("", C_WHITE)],),
    ([("claw ❯ ", C_GREEN), ("█", C_WHITE)],),
]

# Screenshot 5: Telemetry Summary
lines_5 = [
    ([("=== Execution Summary ===", C_CYAN)],),
    ([("Status:      ", C_WHITE), ("SUCCESS (VERIFIED)", C_GREEN)],),
    ([("Session ID:  ", C_WHITE), ("ses_8f3d91ca2e04", C_MAGENTA)],),
    ([("Task:        ", C_WHITE), ("Fix parameter parsing issue in router.ts", C_WHITE)],),
    ([("Target Repo: ", C_WHITE), ("/Users/abhaysingh/Downloads/pi-main/inductionharness/test-repos/repo-a", C_YELLOW)],),
    ([("Steps Taken: ", C_WHITE), ("4 turns", C_WHITE)],),
    ([("Duration:    ", C_WHITE), ("15.2s", C_WHITE)],),
    ([("Token Usage: ", C_WHITE), ("4200 total ", C_YELLOW), ("(4000 prompt, 200 completion)", C_DIM)],),
    ([("Run Trace:   ", C_WHITE), ("traces/run_ses_8f3d91ca2e04.json", C_CYAN)],),
    ([("Summary:     ", C_WHITE), ("Parameter parsing bug fixed, 20/20 tests passing, atomic snapshot finalized.", C_WHITE)],),
    ([("", C_WHITE)],),
    ([("=== Invariant Check: ===", C_GREEN)],),
    ([("  [✓] Zero Unvalidated Tools  (100% Zod validated)", C_GREEN)],),
    ([("  [✓] Sandbox Jail Path Confinement (0 escapes)", C_GREEN)],),
    ([("  [✓] Mandatory Verification Gate Passed (exit code 0)", C_GREEN)],),
    ([("  [✓] Full Telemetry Trace Persisted", C_GREEN)],),
]

create_terminal_image("codeforge — zsh — 80x24", [l[0] for l in lines_1], "screenshot_1_repl.png")
create_terminal_image("codeforge — task execution — 80x24", [l[0] for l in lines_2], "screenshot_2_fsm_act.png")
create_terminal_image("codeforge — git diff viewer — 80x24", [l[0] for l in lines_3], "screenshot_3_diff.png")
create_terminal_image("codeforge — verification gate — 80x24", [l[0] for l in lines_4], "screenshot_4_verification.png")
create_terminal_image("codeforge — telemetry odometer — 80x24", [l[0] for l in lines_5], "screenshot_5_telemetry.png")
print("All screenshots generated successfully.")
