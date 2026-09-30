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
gpu_power_limit_watts: 280   # powerlimit task only; baked in by the installer, not read at TUI start
gpu_clock_mhz: 0             # powerlimit task -Clock; 0 = unlocked. Not read at TUI start
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
| `m` | model sources panel |
| `g` | scripts menu (GPU profile) |
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
- Only complete answers get a grade. A run that stops on the token cap
  (`FinishReason=length`) is reported as `trunc` with no grade, because its
  answer is cut off or absent. The TLDR score uses graded rows only and the
  `graded` column shows the coverage, for example `3/10`.
- The coding report names the OMP build (`harness: omp 18.1.15`) next to the
  engine, because coding grades follow OMP's PowerShell conventions. Other
  prompt sets show the engine only.
- Verdict analysis (`meta/muse-glimmer-30b` on NVIDIA NIM, reasoning effort high)
  when `NVIDIA_API_KEY` is set. Without a verdict the report states the reason
  (missing key, HTTP status, timeout) for every prompt set.
- Report opens automatically headless; in the TUI press `o`.

## Session stats

While a server runs, `/metrics` is polled every 5 s and persisted atomically to
`sessions/current.json`; on stop it archives to `sessions/<ts>-<config>.json`.

## GPU profile

Three scheduled tasks run the PowerShell scripts with highest privileges, so the
TUI needs no elevated shell:

```pwsh
sudo pwsh -File scripts/gpu-undervolt-tasks-install.ps1       # once, registers all three
pwsh -File scripts/gpu-undervolt-tasks-run.ps1                # Anbeeld curve (same as logon)
pwsh -File scripts/gpu-undervolt-tasks-run.ps1 -PowerLimit    # power limit only, no curve
pwsh -File scripts/gpu-undervolt-tasks-run.ps1 -Revert        # back to baseline
```

|Task|Runs|Trigger|
|---|---|---|
|`beellama-gpu-undervolt-apply`|`gpu-undervolt-curve-1605-750.ps1`|**at logon**, and on TUI start|
|`beellama-gpu-undervolt-powerlimit`|`gpu-undervolt-apply.ps1 -PowerLimit 280 -Clock 0`|on demand|
|`beellama-gpu-undervolt-revert`|`gpu-undervolt-revert.ps1`|on demand|

In the TUI press `g` for the scripts menu, then run an action. The panel shows
the live limit and clock, and reports the task result.

The apply task has an at-logon trigger, so the card comes up on the Anbeeld
curve by default. The other two have no trigger: run them manually. The TUI
runs the apply task once when it starts, so after a manual switch to the power
limit or a revert, starting the TUI returns the card to the curve. That is the
only point at which the profile is applied besides logon — a config launch does
not touch the GPU.

`gpu_power_limit_watts` in `beellama-tui.yaml` is the single source of truth for
the **powerlimit** task. It is baked in when the installer runs, and the
installer reads it from that file when `-PowerLimit` is omitted. The apply task
ignores it: `gpu-undervolt-curve-1605-750.ps1` carries its own 300 W default.
`gpu_clock_mhz` is the same for the powerlimit task's clock. Re-run the installer
after changing either value:

```pwsh
sudo pwsh -File scripts/gpu-undervolt-tasks-install.ps1   # picks up the yaml values
```

If the tasks are not installed, TUI start falls back to running
`gpu-undervolt-curve-1605-750.ps1` directly rather than `nvidia-smi -pl`.
nvidia-smi cannot set voltage, so a power-limit-only fallback would land on a
profile the apply task never produces. When both paths fail, the TUI reports the
curve error and the task error together.

Measured on this box with Qwen3.8-27B-UD-Q4_K_M (pp512/tg128, r3) on the card's
existing overclock curve (+45..+150 MHz offsets, not stock):

|Power limit|pp512|tg128|Peak temp|
|---|---|---|---|
|250 W|1110|30.7|61 °C|
|**280 W**|**1221**|**37.0**|63 °C|
|310 W|1224|36.7|65 °C|
|340 W|1269|37.5|67 °C|
|370 W|1298|37.7|69 °C|

280 W is the knee: it gains about 10 % prefill and 20 % decode over 250 W for
+2 °C, while 280 → 310 W adds nothing. The card peaks near 64 °C under sustained
load against a 93 °C limit, so it is power-limited, not thermally limited.

A 1350 MHz clock lock was 7 % slower on prefill than an unlocked clock (1028 t/s
against 1106 t/s) and neutral on decode, so `gpu_clock_mhz` defaults to 0.

### Undervolt curve

`scripts/gpu-undervolt-curve-1605-750.ps1` is the logon profile: Ivan
Neustroev's RTX 3090 curve, 1605 MHz at 0.750 V with a 300 W limit, drawing a
typical 240 to 250 W during inference. The stock curve reaches only 1380 MHz at
0.750 V, so the cap adds a 225 MHz offset. The script takes its own defaults and
reads no yaml. Run it by hand from an elevated shell:

```pwsh
sudo pwsh -File scripts/gpu-undervolt-curve-1605-750.ps1
```

`simple-nvidia-undervolt` flattens the curve at the cap, so the clock holds at
1605 MHz at or above 0.750 V. The source curve keeps rising to about 2178 MHz at
1.100 V; this profile is the stricter reading of the same limit.

Because the cap holds at 1605 MHz, prefill-heavy work runs below what an
unlocked clock reaches at the same limit. Use `-PowerLimit` when that matters.

Unstable points on this card, from earlier higher-voltage testing: 875 mV @ 1900
hung once and 900 mV @ 2040 crashed the CUDA context. The 0.750 V cap sits well
below both.

`-Revert` restores `scripts/gpu-baseline-tuning.json`, the card's pre-existing
overclock curve. Clearing to stock instead measured 3 % slower on prefill
(1234 against 1273 t/s), so the baseline file matters. Regenerate it from the
tool with `status --out-tuning-file`.

nvidia-smi settings do not survive a reboot; the logon trigger re-applies them.
Run `-Revert` before gaming: the serving limit costs performance at full load.

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

## Releases

A tag `v*` runs `.github/workflows/release.yml`: it runs the tests, builds
`dist/beellama-tui.exe` with `bun build --compile`, and attaches the exe to a
GitHub release.

```pwsh
git tag v0.2.0
git push origin v0.2.0
```

Download the exe from the release page and put it in the repo root (the exe
finds `beellama-tui.yaml` next to itself or one level up).
