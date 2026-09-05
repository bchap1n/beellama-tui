// TUI root: config list, filters, launch/output views, stats, benchmark panel.
import { Box, Text, useApp, useInput, render } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadAppConfig } from "../config.ts";
import { loadAll } from "../cli.ts";
import { resolveBinary } from "../binary.ts";
import { deriveFacets, resolveConfig } from "../launch-config.ts";
import { getRunningServer, launchServer, stopServer } from "../server.ts";
import { SessionTracker } from "../metrics.ts";
import { ConfigList } from "./ConfigList.tsx";
import { Filters, emptyFilters, filtersActive, matchesFilters, type FacetFilters } from "./Filters.tsx";
import { Sources } from "./Sources.tsx";
import { LaunchView, OutputView } from "./LaunchView.tsx";
import { StatsBar } from "./StatsBar.tsx";
import { probeGpu, type GpuStats } from "./gpu.ts";
import { Benchmark, SET_LABELS, type BenchPanelState } from "./Benchmark.tsx";
import { runBenchmark, type BenchProgress } from "../bench/runner.ts";
import type { AppConfig, ResolvedConfig, SessionStats } from "../types.ts";

type SortKey = "name" | "model" | "quant" | "ctx" | "provider" | "spec";
const SORT_KEYS: SortKey[] = ["name", "model", "quant", "ctx", "provider", "spec"];

function App(props: { appCfg: AppConfig; configs: ResolvedConfig[]; errors: string[] }): React.ReactElement {
  const { exit } = useApp();
  const [configs, setConfigs] = useState(props.configs);
  const [selected, setSelected] = useState(0);
  const [parseErrors, setParseErrors] = useState<string[]>(props.errors);
  const [filterText, setFilterText] = useState("");
  const [filters, setFilters] = useState<FacetFilters>(emptyFilters);
  const [filterCursor, setFilterCursor] = useState(0);
  const [sortIdx, setSortIdx] = useState(0);
  const [showOutput, setShowOutput] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [server, setServer] = useState(() => getRunningServer());
  const [error, setError] = useState<string | undefined>(undefined);
  const [stats, setStats] = useState<SessionStats | undefined>(undefined);
  const [gpu, setGpu] = useState<GpuStats | undefined>(undefined);
  const [bench, setBench] = useState<BenchPanelState>({
    open: false, focus: 0,
    set: "standard", runs: props.appCfg.benchmark.runs,
    running: false,
  });
  const trackerRef = useRef<SessionTracker | undefined>(undefined);
  const lastLaunchedRef = useRef<string | undefined>(undefined);
  const abortBenchRef = useRef(false);
  const outputScrollRef = useRef(0);

  // Server liveness + stats refresh
  useEffect(() => {
    const t = setInterval(() => {
      setServer(getRunningServer());
      setStats(trackerRef.current?.stats);
    }, 500);
    return () => clearInterval(t);
  }, []);

  // GPU stats refresh (nvidia-smi spawn ~100ms; slower cadence than server poll)
  useEffect(() => {
    setGpu(probeGpu());
    const t = setInterval(() => setGpu(probeGpu()), 2000);
    return () => clearInterval(t);
  }, []);

  const rows = useMemo(() => {
    let out = configs;
    if (filterText) {
      const q = filterText.toLowerCase();
      out = out.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        c.facets.model.toLowerCase().includes(q) ||
        c.facets.provider.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q)));
    }
    if (filtersActive(filters)) out = out.filter((c) => matchesFilters(c, filters));
    const key = SORT_KEYS[sortIdx];
    const facetKey = key === "name" ? ("model" as const) : key;
    const dir = key === "ctx" ? -1 : 1;
    return [...out].sort((a, b) => dir * String(a.facets[facetKey]).localeCompare(String(b.facets[facetKey]), undefined, { numeric: true }));
  }, [configs, filterText, filters, sortIdx]);

  // Latest rows/selection for input handlers: rapid keypresses otherwise act on a
  // stale render closure and launch the wrong row (e.g. glimmer instead of qwen).
  const viewRef = useRef({ rows, selected });
  viewRef.current.rows = rows; // rows sync from render; selected is write-through only

  useEffect(() => {
    const cur = Math.min(viewRef.current.selected, Math.max(0, rows.length - 1));
    viewRef.current.selected = cur;
    if (selected !== cur) setSelected(cur);
  }, [rows, selected]);
  const rescan = useCallback(async () => {
    setError(undefined);
    const appCfg = await loadAppConfig();
    const { configs: fresh, errors } = await loadAll(appCfg);
    const resolvedFresh: ResolvedConfig[] = [];
    for (const c of fresh) {
      try {
        resolvedFresh.push(resolveConfig(c, resolveBinary(c.build, appCfg), "", appCfg.model_roots));
      } catch (e) {
        errors.push(`${c.name}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
      }
    }
    setConfigs(resolvedFresh);
    setParseErrors(errors);
  }, []);


  const doLaunch = useCallback(async (cfg: ResolvedConfig) => {
    setError(undefined);
    try {
      await stopServer(cfg.port || props.appCfg.server.port);
      trackerRef.current?.stop();
      await launchServer(cfg, props.appCfg);
      lastLaunchedRef.current = cfg.name;
      const tracker = new SessionTracker();
      tracker.start(cfg.name, getRunningServer()?.pid ?? 0, serverUrlOf(props.appCfg));
      trackerRef.current = tracker;
      setServer(getRunningServer());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [props.appCfg]);

  const doStop = useCallback(async () => {
    setError(undefined);
    await trackerRef.current?.stop();
    trackerRef.current = undefined;
    await stopServer();
    setServer(undefined);
    setStats(undefined);
  }, []);

  const benchTargets = (): ResolvedConfig[] => {
    const sel = viewRef.current.rows[viewRef.current.selected];
    return sel ? [sel] : [];
  };

  const startBench = useCallback(async (state: BenchPanelState) => {
    const targets = benchTargets();
    if (targets.length === 0) {
      setBench((b) => ({ ...b, summary: "no config highlighted — move the cursor to a row first" }));
      return;
    }
    abortBenchRef.current = false;
    // Coding set grades one sample per prompt; extra runs would only duplicate rows.
    const runs = state.set === "coding" ? 1 : state.runs;
    setBench((b) => ({ ...b, running: true, progress: undefined, summary: `starting ${targets[0].name} · ${SET_LABELS[state.set] ?? state.set}` }));
    const onProgress = (p: BenchProgress) => setBench((b) => ({ ...b, progress: p }));
    try {
      await runBenchmark(
        { config: "", set: state.set, runs },
        onProgress,
        () => abortBenchRef.current,
        targets,
      );
      setBench((b) => ({
        ...b,
        running: false,
        summary: abortBenchRef.current
          ? `aborted — partial results in ${latestBenchDir() ?? "benchmarks/"}`
          : `done · ${SET_LABELS[state.set] ?? state.set}`,
        resultDir: latestBenchDir(),
      }));
    } catch (e) {
      setBench((b) => ({ ...b, running: false, summary: `failed: ${e instanceof Error ? e.message : String(e)}` }));
    }
  }, []);

  useInput((input, key) => {
    if (bench.running) {
      if (key.escape) {
        abortBenchRef.current = true;
        setBench((b) => ({ ...b, summary: "aborting after current run…" }));
      }
      // Live view stays usable while the bench runs.
      else if (input === "v" || (key.meta && input === "v")) setShowOutput((v) => !v);
      else if (key.pageUp || key.pageDown) outputScrollRef.current += key.pageDown ? 10 : -10;
      return;
    }

    if (showFilters) {
      if (key.escape || key.return) { setShowFilters(false); return; }
      const vals = flatFilterValues();
      if (input === "c") { setFilters(emptyFilters()); setFilterCursor(0); return; }
      if (key.leftArrow) { setFilterCursor((n) => Math.max(0, n - 1)); return; }
      if (key.rightArrow) { setFilterCursor((n) => Math.min(vals.length - 1, n + 1)); return; }
      if (key.upArrow) { setFilterCursor((n) => Math.max(0, n - 6)); return; }
      if (key.downArrow) { setFilterCursor((n) => Math.min(vals.length - 1, n + 6)); return; }
      if (input === " ") {
        const cur = vals[filterCursor];
        if (cur) toggleFilterValue(cur.facet, cur.value);
        return;
      }
      return;
    }

    if (bench.open) {
      if (key.escape) { setBench((b) => ({ ...b, open: false })); return; }
      const SETS = ["standard", "longctx", "coding"] as const;
      if (key.upArrow) setBench((b) => ({ ...b, focus: 0 as 0 | 1 }));
      else if (key.downArrow) setBench((b) => ({ ...b, focus: (b.set === "coding" ? 0 : Math.min(1, b.focus + 1)) as 0 | 1 }));
      else if (key.leftArrow || key.rightArrow) {
        const dir = key.leftArrow ? -1 : 1;
        setBench((b) => {
          if (b.focus === 0) {
            const next = (SETS.indexOf(b.set) + dir + SETS.length) % SETS.length;
            return { ...b, set: SETS[next] };
          }
          return { ...b, runs: Math.max(1, Math.min(5, b.runs + dir)) };
        });
      }
      else if (key.return) void startBench(bench);
      else if (input === "o" && bench.resultDir) {
        void Bun.spawn(["cmd", "/c", "start", "", `${bench.resultDir}/results.html`]).exited;
      }
      return;
    }

    if (filterText.length > 0 && !key.backspace && !key.delete && input.length === 0 && !key.upArrow && !key.downArrow) {
      // typing filter text handled below
    }
    if (key.upArrow) {
      const next = Math.max(0, viewRef.current.selected - 1);
      viewRef.current = { ...viewRef.current, selected: next };
      setSelected(next);
    } else if (key.downArrow) {
      const next = Math.min(viewRef.current.rows.length - 1, viewRef.current.selected + 1);
      viewRef.current = { ...viewRef.current, selected: next };
      setSelected(next);
    }
    else if (key.backspace || key.delete) setFilterText((t) => t.slice(0, -1));
    else if (key.return) {
      const cfg = viewRef.current.rows[viewRef.current.selected];
      if (cfg) void doLaunch(cfg);
    }
    else if (input === "/") setFilterText("");
    else if (input === "f") setShowFilters(true);
    else if (input === "s") setSortIdx((i) => (i + 1) % SORT_KEYS.length);
    else if (input === "v" || (key.meta && input === "v")) setShowOutput((v) => !v);
    else if (input === "x") void doStop();
    else if (input === "r") void rescan();
    else if (input === "l") {
      const cfg = configs.find((c) => c.name === lastLaunchedRef.current);
      if (cfg) void doLaunch(cfg);
    }
    else if (input === "t") cycleThink(viewRef.current.rows[viewRef.current.selected]?.name ?? "");
    else if (input === "b") setBench((b) => ({ ...b, open: !b.open }));
    else if (input === "m") setShowSources((v) => !v);
    else if (input === "q") void quit();
    else if (input.length === 1 && /[a-zA-Z0-9._-]/.test(input)) setFilterText((t) => t + input);
  });

  const cycleThink = (name: string): void => {
    setConfigs((cs) =>
      cs.map((c) => {
        if (c.name !== name) return c;
        let reasoning = c.reasoning;
        let effort = c.reasoning_effort;
        if (!c.reasoning) { reasoning = true; effort = "low"; }
        else if (c.reasoning_effort === "high") { reasoning = false; effort = undefined; }
        else if (c.reasoning_effort === "medium") { effort = "high"; }
        else { effort = "medium"; }
        return { ...c, reasoning, reasoning_effort: effort, facets: { ...c.facets, think: reasoning } };
      }),
    );
  };
  const toggleFilterValue = (facet: keyof FacetFilters, value: string): void => {
    setFilters((f) => {
      const next = new Set(f[facet]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...f, [facet]: next };
    });
  };

  const flatFilterValues = (): { facet: keyof FacetFilters; value: string }[] => {
    const providers = [...new Set(configs.map((r) => r.facets.provider))].sort();
    const specs = [...new Set(configs.map((r) => r.facets.spec))].sort();
    return [
      ...providers.map((v) => ({ facet: "provider" as const, value: v })),
      ...["on", "off"].map((v) => ({ facet: "think" as const, value: v })),
      ...["on", "off"].map((v) => ({ facet: "vision" as const, value: v })),
      ...["yes", "no"].map((v) => ({ facet: "quality" as const, value: v })),
      ...specs.map((v) => ({ facet: "spec" as const, value: v })),
    ];
  };

  const quit = useCallback(async () => {
    await trackerRef.current?.stop();
    await stopServer();
    exit();
  }, [exit]);

  useEffect(() => {
    const cleanup = (): void => {
      void stopServer();
    };
    process.on("exit", cleanup);
    process.on("SIGINT", cleanup);
    process.on("SIGBREAK", cleanup);
    return () => {
      process.off("exit", cleanup);
      process.off("SIGINT", cleanup);
      process.off("SIGBREAK", cleanup);
    };
  }, []);

  const sortLabel = SORT_KEYS[sortIdx];
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="yellow">beellama-tui</Text>
        <Text dimColor> {rows.length} configs · {props.appCfg.model_roots.length} sources</Text>
      </Box>
      {parseErrors.map((e) => <Text key={e} color="red">✗ {e}</Text>)}
      <ConfigList rows={rows} selected={selected} />
      {filterText && <Text>filter: /{filterText}_</Text>}
      <Text dimColor>
        {helpFor(
          { filters: showFilters, benchOpen: bench.open, benchRunning: bench.running, sources: showSources },
          rows.length,
          configs.length,
          sortLabel,
        )}
      </Text>
      <StatsBar stats={stats} gpu={gpu} />
      <LaunchView server={server} error={error} />
      {showOutput && <OutputView server={server} scrollRef={outputScrollRef} />}
      {(bench.open || bench.running) && (
        <Benchmark
          state={bench}
          targets={benchTargets().map((t) => t.name)}
        />
      )}
      {showFilters && (
        <Filters
          rows={configs}
          filters={filters}
          cursor={filterCursor}
          onToggle={toggleFilterValue}
          onClear={() => setFilters(emptyFilters())}
        />
      )}
      {showSources && <Sources roots={props.appCfg.model_roots} rows={configs} />}
    </Box>
  );
}

function helpFor(mode: { filters: boolean; benchOpen: boolean; benchRunning: boolean; sources: boolean }, rowCount: number, total: number, sortLabel: string): string {
  if (mode.benchRunning) return "esc abort · v output · o open last report";
  if (mode.benchOpen) return "↑/↓ field · ←→ change · enter start · esc close";
  if (mode.filters) return "a-z toggle facet · c clear · esc done";
  if (mode.sources) return "esc close";
  return `${rowCount}/${total} shown · sort ${sortLabel} · enter launch · / filter · f facets · s sort · b bench · v output · x stop · l relaunch · space pick · t think · m sources · q quit`;
}

function serverUrlOf(appCfg: AppConfig): string {
  const host = appCfg.server.host === "0.0.0.0" ? "127.0.0.1" : appCfg.server.host;
  return `http://${host}:${appCfg.server.port}`;
}

function latestBenchDir(): string | undefined {
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const base = "benchmarks";
    const dirs = fs.readdirSync(base).sort();
    return dirs.length > 0 ? `${base}/${dirs[dirs.length - 1]}` : undefined;
  } catch {
    return undefined;
  }
}

export async function runTui(): Promise<void> {
  const appCfg = await loadAppConfig();
  const { configs, errors } = await loadAll(appCfg);
  const resolved: ResolvedConfig[] = [];
  for (const c of configs) {
    try {
      const binaryPath = resolveBinary(c.build, appCfg);
      resolved.push(resolveConfig(c, binaryPath, "", appCfg.model_roots));
    } catch (e) {
      errors.push(`${c.name}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
    }
  }
  const { waitUntilExit } = render(<App appCfg={appCfg} configs={resolved} errors={errors} />);
  await waitUntilExit();
}
