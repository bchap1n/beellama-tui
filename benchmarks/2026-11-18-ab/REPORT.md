# pi-LoRA Qwen3.8-27B: speed + quality recovery (2026-11-18)

Goal: make `qwen38-pi-lora-iq4xs-maxctx` as fast as `qwen38-ud-iq4xs-mtp-quality` and
as high quality, understanding why it was slower and "dumber".

## Why it was slower and dumber (measured)

| finding | evidence |
|---|---|
| runtime `--lora` costs +25% per MTP verify cycle | 56.2 ms/cycle vs 44.9 ms/cycle, same 1664 tokens, /metrics draft+accepted counters |
| KVarN4/3 + `--kv-tail-tokens 1024` costs -13% decode and -16% prefill vs q8_0 | 61.5 -> 69.3 tok/s decode, 884 -> 1055 tok/s prefill, identical probe prompt |
| think-mode is speed-neutral | 55.5 tok/s with think ON vs 58.1 OFF (same prompt) |
| LoRA acceptance worry unfounded after merge | merged 65.7% vs ud 65.0-67.6% on identical benchmark prompts |
| the "dumb" part was config, not weights | think OFF + presence_penalty 1.5 -> PSScriptAnalyzer syntax F x3 on code_ps_json_api; ud at temp 1.0/presence 0 scored B+/A there and F x3 on code_ps_apply_patch in its second control block |

## Fixes

1. Merge the adapter into the weights (removes the per-cycle LoRA cost):
   `llama-export-lora` on UD-IQ4_XS + `Qwen3.8-27B-pi-lora-F16.gguf` -> hybrid GGUF
   (LoRA-touched tensors F16, untouched stay quantized; 512 adapter tensors = attn on
   16 blocks + ffn on 64) -> `llama-quantize --allow-requantize ... IQ4_XS` -> 14.2 GiB,
   4.46 BPW. MTP nextn tensors survive and stay active (571 cycles / 1087 accepted).
2. Quality-tier cache: q8_0 K/V at 163840 ctx instead of KVarN at 192K.
3. Sampling per adapter card but presence_penalty 0 (card's 1.5 is for free-form
   chat; it produced syntax-invalid code here).
4. New config `configs/qwen38-pi-merged-iq4xs-mtp-quality.yaml` (doctor 48/48, tests 38/38).

## A/B results (control sandwich: ud -> pi-merged -> ud)

Standard set (4 prompts x 3):

| block | medTok/s | tldrScore | syntax fails | PSA warns | idiom |
|---|---|---|---|---|---|
| 01-ud-standard | 80.5 | 9.93 | 0 | 2.0 | 80 |
| 02-pi-standard | 86.6 | 10.0 | 0 | 1.0 | 85 |
| 03-ud2-standard | 78.0 | 8.03 | 0.5 | 1.5 | 80 |

Coding set (10 prompts x 3):

| block | medTok/s | tldrScore | syntax fails | PSA warns | idiom |
|---|---|---|---|---|---|
| 01-ud-coding | 79.3 | 10.0 | 0 | 0.3 | 81 |
| 02-pi-coding | 85.9 | 10.0 | 0 | 0.6 | 76 |
| 03-ud2-coding | 78.2 | 9.82 | 0.1 | 0.4 | 79 |

Long context (5 prompts x 3, 161K-token prompts):

| block | wall | first-rep TTFT | needle hits | decode tok/s |
|---|---|---|---|---|
| 04-ud-longctx | 24.0 min | 239-242 s | 12/12 | 47.4 |
| 05-pi-longctx | 21.4 min | 245-251 s | 10/12 | 48.8 |

Old pi-lora run for reference (2026-11-18-pi-lora): 57.6 tok/s weighted, 59.7 ms/cycle,
1547 s of 161K prefill (522 tok/s), F x3 on code_ps_json_api.

Merged: 1171.8 s of 161K prefill (688 tok/s) vs ud 1139.1 s (707) vs old 1547 s (522).

Only 12 of the 15 rows per block carry a needle check (code_extract has no `expect`),
hence x/12. Do NOT read `medTok` on this set as speed: TokPerSec divides total wall
time including the ~240 s first-rep prefill, and completions differ wildly (pi-merged
answers in 11-35 tokens with thinking off; ud's rows carry hidden reasoning of
90-3453 tokens). The comparable numbers are decode tok/s, first-rep TTFT and wall.

## Gates

- Perplexity (same corpus, -c 2048, 4 chunks): UD-IQ4_XS 1.5338 +/- 0.0276;
  merged 1.5344 +/- 0.0277 -> double-quant merge damage not measurable.
- Output sanity: no loops, all `stop`, sane lengths in the candidate samples.
- Long-context multi-hop: candidate missed `ctx_multi_hop` (expect 248) on reps 2-3
  in run 05 (10/12 needle rows); ud hit 12/12. Reproduction run 06 hit 12/12
  (multi_hop 3/3, same 4-token answers) -> the miss is sampling variance at temp 0.7,
  not a weights or merge defect. Two-run candidate total: 22/24 needle rows.

## Scoring ceiling (answers the "+20% more intelligent" ask)

tldrScore is capped at 10.0 and pi-lora already sat 9.84, so a 20% relative gain is
unrepresentable on that scale. What actually moved:
- the PSScriptAnalyzer syntax F on `code_ps_json_api` is gone (F x3 -> A x3, idiom 90 vs ud 80);
- candidate tldrScore 10.0 in both sets vs ud 9.93 / 8.03 (standard) and 10.0 / 9.82 (coding);
- two of three ud blocks lost a prompt to syntax failures; the candidate lost none.

## Limits / not done

- exllamav3 fork untouched: llama.cpp reached parity (86.6 vs 80.5/78.0 decode,
  10.0 vs 9.93/8.03 and 10.0/9.82 tldrScore), so no engine change was justified.
- pi harness: vanilla pi 0.73.1 installed (`~/.pi/agent/models.json` -> beellama/localmodel)
  and smoke-tested against the merged model: pi's read tool round-trip returned the
  file's value correctly ("pi-merged-smoke-42"). pi's bash tool needs WSL2, which this
  box does not have; that is a host limitation, not a model one.
- 160K q8_0 leaves ~1.0 GiB free; drop to 147456 if desktop drift OOMs.

## ExLlamaV3 fork contingency (checked, engine change not justified)

`qwen38-exl3-pi-adapted-400bpw-mtp-maxctx` (PEFT LoRA over turboderp EXL3 4.00bpw, the
patched serve_openai.py --lora path) was smoke-benched on 2026-11-18:
4 prompts x 1 (single rep, only 2 graded), medTok 50.3, medDecode 54.0, 1.5 min wall,
tldrScore 8.13 with code_ps_json_api F (syntax) once. The F is a signal, not a
quality verdict: one rep, and this config sets no sampling block (server defaults).
Speed is the decidable part: 50.3 tok/s vs 86.6 for the merged GGUF. The llama.cpp merged config does 86.6 tok/s and
10.0 on the same prompts, so the fork's dynamic-LoRA path is both slower and carries
the same presence-penalty/think-off behavior. Merging the PEFT adapter into the EXL3
weights would be the equivalent fix there; it is not needed to meet the target.
