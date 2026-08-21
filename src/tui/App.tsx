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
import { Benchmark, type BenchPanelState } from "./Benchmark.tsx";
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
  const [sortIdx, setSortIdx] = useState(0);
  const [showOutput, setShowOutput] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [server, setServer] = useState(() => getRunningServer());
  const [error, setError] = useState<string | undefined>(undefined);
  const [stats, setStats] = useState<SessionStats | undefined>(undefined);
  const [bench, setBench] = useState<BenchPanelState>({
    open: false, scopeRow: 0, setRow: 0, runsRow: 6,
    scope: "filtered", picked: new Set(), set: "standard", runs: props.appCfg.benchmark.runs,
    running: false,
  });
  const trackerRef = useRef<SessionTracker | undefined>(undefined);
  const lastLaunchedRef = useRef<string | undefined>(undefined);
  const abortBenchRef = useRef(false);

  // Server liveness + stats refresh
  useEffect(() => {
    const t = setInterval(() => {
      setServer(getRunningServer());
      setStats(trackerRef.current?.stats);
    }, 500);
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

  useEffect(() => {
    if (selected >= rows.length) setSelected(Math.max(0, rows.length - 1));
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
      await stopServer();
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

  const startBench = useCallback(async (state: BenchPanelState, visibleRows: ResolvedConfig[]) => {
    let targets: ResolvedConfig[];
    if (state.scope === "all") targets = configs;
    else if (state.scope === "picked") targets = configs.filter((c) => state.picked.has(c.name));
    else targets = visibleRows;
    if (targets.length === 0) {
      setBench((b) => ({ ...b, summary: "no configs in scope" }));
      return;
    }
    abortBenchRef.current = false;
    setBench((b) => ({ ...b, running: true, progress: undefined, summary: undefined }));
    const onProgress = (p: BenchProgress) => setBench((b) => ({ ...b, progress: p }));
    try {
      await runBenchmark(
        { config: "", set: state.set, runs: state.runs },
        onProgress,
        () => abortBenchRef.current,
        targets,
      );
      setBench((b) => ({
        ...b,
        running: false,
        summary: `done — ${targets.length} config(s), ${state.set} set`,
        resultDir: latestBenchDir(),
      }));
    } catch (e) {
      setBench((b) => ({ ...b, running: false, summary: `failed: ${e instanceof Error ? e.message : String(e)}` }));
    }
  }, [configs]);

  useInput((input, key) => {
    if (bench.running) {
      if (key.escape) {
        abortBenchRef.current = true;
        setBench((b) => ({ ...b, summary: "aborting after current run…" }));
      }
      return;
    }

    if (showFilters) {
      if (key.escape || key.return) { setShowFilters(false); return; }
      if (input === "c") { setFilters(emptyFilters()); return; }
      toggleFilterAt(input);
      return;
    }

    if (bench.open) {
      if (key.escape) { setBench((b) => ({ ...b, open: false })); return; }
      if (key.upArrow) setBench((b) => ({ ...b, scopeRow: Math.max(0, b.scopeRow - 1), setRow: Math.max(0, b.setRow - 1), runsRow: Math.max(4, b.runsRow - 1) }));
      else if (key.downArrow) setBench((b) => ({ ...b, scopeRow: Math.min(2, b.scopeRow + 1), setRow: Math.min(2, b.setRow + 1), runsRow: Math.min(6, b.runsRow + 1) }));
      else if (input === " ") {
        setBench((b) => {
          const row = b.runsRow <= 2 ? b.scopeRow : b.runsRow <= 5 ? b.setRow : 6;
          if (row <= 2) {
            const scopes = ["filtered", "all", "picked"] as const;
            return { ...b, scope: scopes[row], scopeRow: row };
          }
          if (row <= 5) {
            const sets = ["standard", "coding", "longctx"] as const;
            return { ...b, set: sets[b.setRow], setRow: b.setRow };
          }
          return b;
        });
      }
      else if (key.leftArrow && bench.runsRow === 6) setBench((b) => ({ ...b, runs: Math.max(1, b.runs - 1) }));
      else if (key.rightArrow && bench.runsRow === 6) setBench((b) => ({ ...b, runs: Math.min(5, b.runs + 1) }));
      else if (key.return) void startBench(bench, rows);
      else if (input === "o" && bench.resultDir) {
        void Bun.spawn(["cmd", "/c", "start", "", `${bench.resultDir}/results.html`]).exited;
      }
      return;
    }

    if (filterText.length > 0 && !key.backspace && !key.delete && input.length === 0 && !key.upArrow && !key.downArrow) {
      // typing filter text handled below
    }
    if (key.upArrow) setSelected((n) => Math.max(0, n - 1));
    else if (key.downArrow) setSelected((n) => Math.min(rows.length - 1, n + 1));
    else if (key.backspace || key.delete) setFilterText((t) => t.slice(0, -1));
    else if (key.return) {
      const cfg = rows[selected];
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
    else if (input === "b") setBench((b) => ({ ...b, open: !b.open }));
    else if (input === "m") setShowSources((v) => !v);
    else if (input === " ") {
      const cfg = rows[selected];
      if (cfg) setBench((b) => {
        const picked = new Set(b.picked);
        if (picked.has(cfg.name)) picked.delete(cfg.name);
        else picked.add(cfg.name);
        return { ...b, picked };
      });
    }
    else if (input === "q") void quit();
    else if (input.length === 1 && /[a-zA-Z0-9._-]/.test(input)) setFilterText((t) => t + input);
  });

  const toggleFilterAt = (_input: string): void => {
    // Simple approach: cycle through known facet values by first letter is fragile;
    // instead space toggles the value under the cursor position is complex in Ink.
    // Keep it simple: number keys 1-9 toggle provider entries, letters for others.
    setFilters((f) => {
      const providers = [...new Set(configs.map((r) => r.facets.provider))].sort();
      const idx = Number(_input);
      if (!Number.isNaN(idx) && idx >= 1 && idx <= providers.length) {
        const p = providers[idx - 1];
        const next = new Set(f.provider);
        if (next.has(p)) next.delete(p);
        else next.add(p);
        return { ...f, provider: next };
      }
      return f;
    });
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
      <Text bold color="green">beellama-tui</Text>
      {parseErrors.map((e) => <Text key={e} color="red">✗ {e}</Text>)}
      <ConfigList rows={rows} selected={selected} />
      {filterText && <Text>filter: /{filterText}_</Text>}
      <Text dimColor>
        {rows.length}/{configs.length} shown · sort {sortLabel} · up/down select · enter launch · / filter · f facets · s sort · b bench · v output · x stop · l relaunch · space pick · m sources · q quit
      </Text>
      <StatsBar stats={stats} />
      <LaunchView server={server} error={error} />
      {showOutput && <OutputView server={server} />}
      {(bench.open || bench.running) && <Benchmark state={bench} />}
      {showFilters && <Filters rows={configs} filters={filters} />}
      {showSources && <Sources roots={props.appCfg.model_roots} rows={configs} />}
    </Box>
  );
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
