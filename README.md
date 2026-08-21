# beellama-tui

Windows terminal UI for launching llama-server (beellama.cpp) GGUF configurations.
Replaces the PowerShell launcher harness in `~/github/beellama` (`start-beellama.ps1`,
`run/*.ps1`, `benchmark/run_benchmark.ps1`). TypeScript + Bun + Ink, one compiled exe.

## Install

Requires [Bun](https://bun.sh) 1.3+.

```pwsh
bun install
bun run build          # produces dist/beellama-tui.exe
```

## Usage

```pwsh
beellama-tui              # TUI
beellama-tui --list       # config table
beellama-tui doctor       # validate all configs (binary + gguf paths)
beellama-tui bench --config <name> [--set standard|coding|longctx] [--runs N] [--out dir]
```

## Configuration

`beellama-tui.yaml` (repo root):

```yaml
beellama_repo: C:/Users/brock/Documents/github/beellama
model_roots:                 # multiple sources; provider = first path segment under a root
  - D:/.lmstudio/models
  - C:/Users/brock/.lmstudio/models
server: { host: 127.0.0.1, port: 8082 }
configs_dir: configs
gpu_power_limit_watts: 250   # best-effort nvidia-smi -pl before launch
binaries: { }                # optional per-build path overrides
benchmark:
  runs: 3
  max_tokens: 2048
  warmup_runs: 3
  warmup_tokens: 256
  config_cooldown_sec: 60
  retries: 2
  timeout_sec: 180
```

## Launch configs

One YAML file per config in `configs/`. Drop a file in — no recompile.

```yaml
name: qwen38-ud-q4km-mtp-maxctx      # required, unique
label: Qwen3.8-27B UD-Q4_K_M MTP     # optional display name
tags: [maxctx]                       # "quality" tag drives the quality facet
build: beellama                      # binary key from run/config.json (+ lucebox)
model:
  gguf: D:/.lmstudio/models/unsloth/qwen3.8-27B-gguf/Qwen3.8-27B-UD-Q4_K_M.gguf
  mmproj: ...                        # optional; enables vision facet
  provider: unsloth                  # optional override of folder-derived provider
draft: { gguf: ... }                 # optional draft model
spec: { type: draft-mtp, draft_max: 2 }   # none | draft-mtp | draft-dflash | draft-dspark | raw
ctx_size: 163840
batch: 4096
ubatch: 512
cache_k: kvarn4
cache_v: kvarn3
kv_tail_tokens: 1024
reasoning: true
reasoning_effort: low                # folded into --chat-template-kwargs
sampling: { temp: 0.7, top_p: 0.80, top_k: 20 }
extra_args: ["--n-cpu-moe", "4"]     # raw passthrough for anything else
```

Unknown keys are an error (typo protection) except inside `extra_args`.
Validation errors name the file and YAML path.

## Hotkeys

| Key | Action |
|---|---|
| up/down | select config |
| enter | launch selected |
| `/` | clear/set text filter (type to filter) |
| `f` | facet filter modal |
| `s` | cycle sort (name → model → quant → ctx desc → provider → spec) |
| `b` | benchmark panel (scope / prompt set / runs, live progress) |
| `v` or alt-v | toggle live server output view |
| `x` | stop server |
| `l` | relaunch last |
| space | pick config for bench scope |
| `q` | quit (stops server first) |

## Benchmark

Full parity with the legacy PowerShell harness:

- Prompt sets: `prompts/prompts.json`, `prompts-coding.json`, `prompts-longctx.json`
  (LongCtx haystack expansion ports `Expand-LongCtxPrompts` exactly).
- Streaming measurement: TTFT to first chunk, decode tok/s after TTFT, usage chunk.
- Warmup runs, retries, medians.
- CSV header byte-identical to the legacy `results.csv`.
- Coding set adds PSScriptAnalyzer quality grades via the existing
  `beellama/benchmark/quality_analysis.ps1` (bridge driver `scripts/qa-driver.ps1`;
  missing module leaves QA columns empty).
- DeepSeek verdict (`deepseek-v4-flash`) when `DEEPSEEK_API_KEY` is set; skipped silently otherwise.
- Report opens automatically headless; in the TUI press `o`.

## Session stats

While a server runs, `/metrics` is polled every 5 s and persisted atomically to
`sessions/current.json`; on stop it archives to `sessions/<ts>-<config>.json`.

## omp extension

```pwsh
scripts/install-extension.ps1    # copies extension/beellama.ts to ~/.omp/agent/extensions
```

Then use `/bee-stats` in omp: local output/prompt tokens, avg tok/s, spec-decode
accept rate, elapsed time, plus remote session token/cost totals.

## Development

```pwsh
bun test        # unit + stub-server integration tests (no GPU needed)
bun run dev     # run from source
```

Real-model launch smoke test is manual by design: pick a config, press enter,
alt-v for server output.
