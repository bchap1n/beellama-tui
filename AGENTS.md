# AGENTS.md — beellama-tui

Ink TUI + catalog of launch configs for llama-server (beellama.cpp build) and
exllamav3 on a single RTX 3090 (24 GB). Benchmarks live in `benchmarks/<date>*/`.

## Commands

- Validate every touched config: `bun src/cli.ts doctor` (must end 48/48 ok).
- Test suite: `bun test` (38 tests; needs no external binaries).
- Benchmark a config: `bun src/cli.ts bench --config <name> --set standard|coding|longctx|all --runs N --out benchmarks/<dir>`.
- PowerShell harness: sibling repo `../beellama/benchmark/` (`run_benchmark.ps1`,
  grading via `quality_analysis.ps1` in the same dir) - NOT inside this repo.
- Never launch a server just to check flags; use static config validation.

## Config conventions (configs/*.yaml)

- One config = one model + one purpose. `name:` matching the filename is a
  convention, NOT enforced: `bench --config` resolves on the YAML `name:` field
  (src/bench/runner.ts), and a duplicate `name:` across configs is a hard load
  error. Renaming a file without renaming `name:` silently retargets `--config`.
- Record VRAM measurements and the OOM fallback ladder in the header comment
  (drop `ctx_size` before touching cache types).
- `spec: { type: draft-mtp }` uses the model's own MTP head (Qwen `nextn` tensors).
  MTP is speed-neutral-to-positive; it does not change quality.

## Measured lessons (2026-11-18, evidence: benchmarks/2026-11-18-ab/REPORT.md)

- Runtime `--lora` costs **+25 % per MTP verify cycle**. Merge adapters into the
  GGUF instead (`llama-export-lora` -> hybrid -> `llama-quantize --allow-requantize`),
  and gate the merge with a perplexity check against the stock quant.
- KVarN4/3 KV with `--kv-tail-tokens` costs **-13 % decode / -16 % prefill** vs
  `q8_0`. Use KVarN only when the q8_0 KV does not fit the target context.
- `presence_penalty: 1.5` (from unsloth non-thinking chat cards) produced
  PSScriptAnalyzer syntax failures on benchmark coding prompts. Use `0.0`.
- llama-server `/metrics` draft/accept counters give per-verify-cycle cost —
  comparable across runs where raw tok/s is not (acceptance varies with content).
- Long-context rows: `TokPerSec` there divides by wall incl. the ~240 s 161K
  prefill; compare decode tok/s, first-rep TTFT and wall instead.
- exllamav3 PEFT-LoRA path (serve_openai.py --lora) runs ~50 tok/s vs 86.6 for
  the merged GGUF on the same card; prefer merged weights on that stack too.
