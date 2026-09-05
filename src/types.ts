// Shared domain types for beellama-tui.

export interface LaunchConfig {
  name: string;
  label?: string;
  description?: string;
  tags: string[];
  build: string;
  model: {
    gguf?: string;
    provider?: string;
    mmproj?: string;
    dir?: string;
  };
  draft?: { gguf: string };
  cache_quant?: string;
  draft_mode?: "mtp" | "dflash2" | "none";
  ctx_size?: number;
  spec?: { type: string; draft_max?: number; cross_ctx?: number };
  batch?: number;
  ubatch?: number;
  cache_k?: string;
  cache_v?: string;
  kv_tail_tokens?: number;
  kv_unified?: boolean;
  ngl: number | "all";
  flash_attn: boolean;
  no_mmap?: boolean;
  mlock?: boolean;
  reasoning: boolean;
  reasoning_effort?: string;
  sampling?: Sampling;
  extra_args: string[];
  port: number;
  env: Record<string, string>;
}

export interface Sampling {
  temp?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  presence_penalty?: number;
  repeat_penalty?: number;
}

export type SpecFacet = "none" | "mtp" | "dflash" | "dspark" | "other";

export interface Facets {
  provider: string;
  quant: string;
  model: string;
  ctx: number;
  think: boolean;
  vision: boolean;
  quality: boolean;
  spec: SpecFacet;
}

export interface ResolvedConfig extends LaunchConfig {
  file: string;
  facets: Facets;
  binaryPath: string;
}

export interface AppConfig {
  beellama_repo: string;
  model_roots: string[];
  server: { host: string; port: number };
  configs_dir: string;
  binaries?: Record<string, string>;
  gpu_power_limit_watts?: number;
  benchmark: {
    runs: number;
    max_tokens: number;
    warmup_runs: number;
    warmup_tokens: number;
    cooldown_sec: number;
    config_cooldown_sec: number;
    retries: number;
    timeout_sec: number;
  };
}

export interface MetricsSnapshot {
  prompt_tokens_total: number;
  tokens_predicted_total: number;
  prompt_seconds_total: number;
  tokens_predicted_seconds_total: number;
  spec_decode_num_draft_tokens_total: number;
  spec_decode_num_accepted_tokens_total: number;
  n_decode_total: number;
}

export interface SessionStats {
  config: string;
  pid: number;
  startedAt: string;
  updatedAt: string;
  promptTokens: number;
  outputTokens: number;
  outputTokensPerSec: number;
  specDraftTokens: number;
  specAcceptedTokens: number;
  elapsedSec: number;
}

export interface BenchResultRow {
  Config: string;
  Label: string;
  Run: number;
  Prompt: string;
  Type: string;
  PromptTokens: number;
  CompletionTokens: number;
  WallTimeMs: number;
  TTFT_Ms: number;
  TokPerSec: number;
  DecodeTokPerSec: number;
  NeedleHit?: number; // LongContext only: 1 = expected answer found, 0 = missed
  QASyntaxOk?: boolean;
  QAPSAErrors?: number;
  QAPSAWarnings?: number;
  QAIdiomScore?: number;
  QAGrade?: string;
  FinishReason?: string;
}

export interface QualityResult {
  syntaxOk: boolean;
  psaErrors: number;
  psaWarnings: number;
  idiomScore: number;
  grade: string;
}
