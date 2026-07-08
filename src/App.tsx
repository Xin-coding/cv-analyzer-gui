import Plot from "react-plotly.js";
import Plotly from "plotly.js-dist-min";
import type { ReactNode } from "react";
import {
  Download,
  Eye,
  EyeOff,
  FileUp,
  GripVertical,
  Languages,
  Settings2,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { defaultCorrection, referencePresets } from "./lib/constants";
import {
  downloadText,
  downloadWorkbook,
  pointsWorkbook,
  reimportCsv,
  reimportFileName,
  tafelWorkbook
} from "./lib/export";
import { makeT } from "./lib/i18n";
import {
  correctDataset,
  inferDefaultFitRange,
  isRawPotential,
  linearTafelFit,
  mergedCorrection,
  selectBranch,
  selectCycles,
  yAxisKey
} from "./lib/math";
import { parseFiles } from "./lib/parser";
import type {
  BranchMode,
  CorrectedPoint,
  CorrectionSettings,
  CycleDisplayMode,
  Dataset,
  Language,
  NormalizeMode,
  ReferencePresetId,
  TafelFit,
  TafelFitWindow
} from "./lib/types";

type PlotPanel = "cv" | "lsv" | "tafel";
type ImageFormat = "png" | "svg";
type NumberConstraint = "any" | "positive" | "nonNegative";
const FIT_POTENTIAL_DECIMALS = 3;

interface HoverPoint {
  panel: PlotPanel;
  x: number;
  y: number;
  color: string;
}

interface TafelFitRow {
  dataset: Dataset;
  points: CorrectedPoint[];
  window?: TafelFitWindow;
  fit: TafelFit | null;
}

interface TafelShapeMeta {
  datasetId: string;
  boundary: "start" | "end";
}

export default function App() {
  const [language, setLanguage] = useState<Language>("zh");
  const [activePanel, setActivePanel] = useState<"cv" | "tafel">("cv");
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [settings, setSettings] = useState<CorrectionSettings>(defaultCorrection);
  const [cycleMode, setCycleMode] = useState<CycleDisplayMode>("last");
  const [branchMode, setBranchMode] = useState<BranchMode>("forward");
  const [stacked, setStacked] = useState(false);
  const [stackStep, setStackStep] = useState(10);
  const [showDirection, setShowDirection] = useState(true);
  const [fitRange, setFitRange] = useState({ start: 0, end: 1 });
  const [fitWindows, setFitWindows] = useState<Record<string, TafelFitWindow>>({});
  const [tafelFocus, setTafelFocus] = useState(true);
  const [error, setError] = useState<string>("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [hoverPoint, setHoverPoint] = useState<HoverPoint | null>(null);
  const cvPlotRef = useRef<HTMLElement | null>(null);
  const lsvPlotRef = useRef<HTMLElement | null>(null);
  const tafelPlotRef = useRef<HTMLElement | null>(null);
  const t = makeT(language);

  const orderedDatasets = useMemo(
    () => [...datasets].sort((a, b) => a.order - b.order),
    [datasets]
  );

  const correctedMap = useMemo(() => {
    const map = new Map<string, CorrectedPoint[]>();
    for (const dataset of orderedDatasets) {
      map.set(dataset.id, correctDataset(dataset, settings));
    }
    return map;
  }, [orderedDatasets, settings]);

  const visibleDatasets = orderedDatasets.filter((dataset) => dataset.visible);

  const cvSeries = useMemo(
    () =>
      visibleDatasets.map((dataset, visibleIndex) => {
        const points = selectCycles(correctedMap.get(dataset.id) ?? [], cycleMode);
        const offset = stacked ? visibleIndex * stackStep : 0;
        return { dataset, points, offset };
      }),
    [visibleDatasets, correctedMap, cycleMode, stacked, stackStep]
  );

  const lsvSeries = useMemo(
    () =>
      visibleDatasets.map((dataset) => {
        const points = selectBranch(selectCycles(correctedMap.get(dataset.id) ?? [], "last"), branchMode);
        return { dataset, points };
      }),
    [visibleDatasets, correctedMap, branchMode]
  );

  const yLabel = useMemo(() => {
    const modes = new Set(
      visibleDatasets.map((dataset) => mergedCorrection(settings, dataset.override).normalizeMode)
    );
    return modes.size <= 1 ? t(yAxisKey([...modes][0] ?? settings.normalizeMode)) : t("currentAxisMixed");
  }, [visibleDatasets, settings, t]);

  const allYLabel = useMemo(() => {
    const modes = new Set(
      orderedDatasets.map((dataset) => mergedCorrection(settings, dataset.override).normalizeMode)
    );
    return modes.size <= 1 ? t(yAxisKey([...modes][0] ?? settings.normalizeMode)) : t("currentAxisMixed");
  }, [orderedDatasets, settings, t]);

  const xLabel = useMemo(() => {
    const rawStates = visibleDatasets.map((dataset) =>
      isRawPotential(mergedCorrection(settings, dataset.override))
    );
    if (!rawStates.length) return t("potentialAxisRaw");
    const uniqueStates = new Set(rawStates);
    if (uniqueStates.size > 1) return t("potentialAxisMixed");
    return rawStates[0] ? t("potentialAxisRaw") : t("potentialAxis");
  }, [visibleDatasets, settings, t]);

  const correctionRevision = useMemo(
    () =>
      `${stableJson(settings)}|${orderedDatasets
        .map((dataset) => `${dataset.id}:${dataset.visible}:${stableJson(dataset.override ?? {})}`)
        .join("|")}`,
    [orderedDatasets, settings]
  );
  const cvUiRevision = `cv:${correctionRevision}:${cycleMode}:${stacked}:${stackStep}`;
  const lsvUiRevision = `lsv:${correctionRevision}:${branchMode}`;
  const tafelUiRevision = `tafel:${correctionRevision}:${branchMode}:${stableJson(fitWindows)}:${tafelFocus}`;

  const cvTraces = useMemo(() => {
    const traces = cvSeries.flatMap(({ dataset, points, offset }) => {
      const byCycle = groupByCycle(points);
      return Array.from(byCycle.entries()).map(([cycle, cyclePoints]) => ({
        x: cyclePoints.map((point) => point.correctedPotential),
        y: cyclePoints.map((point) => point.yValue + offset),
        customdata: cyclePoints.map((point) => [point.yValue, cycle]),
        type: "scatter",
        mode: "lines",
        name: dataset.displayName,
        showlegend: false,
        line: { color: dataset.color, width: 2 },
        hovertemplate: `E=%{x:.5f} V<br>${yLabel}=%{customdata[0]:.4g}<br>cycle=%{customdata[1]}<extra></extra>`,
        hoverlabel: hoverLabel(dataset.color)
      }));
    });
    return hoverPoint?.panel === "cv" ? [...traces, hoverTrace(hoverPoint)] : traces;
  }, [cvSeries, hoverPoint, yLabel]);

  const cvDirectionAnnotations = useMemo(() => {
    if (!showDirection) return [];
    return cvSeries.flatMap(({ dataset, points, offset }) =>
      Array.from(groupByCycle(points).values()).flatMap((cyclePoints) =>
        directionAnnotationsFor(cyclePoints, offset)
      )
    );
  }, [cvSeries, showDirection]);

  const lsvTraces = useMemo(() => {
    const traces = lsvSeries.map(({ dataset, points }) => ({
      x: points.map((point) => point.correctedPotential),
      y: points.map((point) => point.yValue),
      customdata: points.map((point) => [point.yValue, branchMode]),
      type: "scatter",
      mode: "lines+markers",
      name: dataset.displayName,
      showlegend: false,
      line: { color: dataset.color, width: 2 },
      marker: { color: dataset.color, size: 4 },
      hovertemplate: `E=%{x:.5f} V<br>${yLabel}=%{customdata[0]:.4g}<br>${t("branch")}=%{customdata[1]}<extra></extra>`,
      hoverlabel: hoverLabel(dataset.color)
    }));
    return hoverPoint?.panel === "lsv" ? [...traces, hoverTrace(hoverPoint)] : traces;
  }, [lsvSeries, hoverPoint, yLabel, branchMode, t]);

  const tafelPointSeries = useMemo(
    () =>
      lsvSeries.map(({ dataset, points }) => ({
        dataset,
        points: points.filter((point) => Number.isFinite(point.yValue) && Math.abs(point.yValue) > 0)
      })),
    [lsvSeries]
  );

  const fitRows = useMemo<TafelFitRow[]>(
    () =>
      tafelPointSeries.map(({ dataset, points }) => {
        const window = fitWindows[dataset.id];
        const fit = window
          ? linearTafelFit(
              dataset.id,
              dataset.displayName,
              points,
              window.startPotential,
              window.endPotential
            )
          : null;
        return { dataset, points, window, fit };
      }),
    [tafelPointSeries, fitWindows]
  );

  const fits = useMemo(
    () => fitRows.map((row) => row.fit).filter((fit): fit is TafelFit => fit !== null),
    [fitRows]
  );

  const tafelRangeOverlay = useMemo(() => {
    const shapes: any[] = [];
    const meta: Array<TafelShapeMeta | null> = [];
    for (const row of fitRows) {
      if (!row.window) continue;
      const start = Math.min(row.window.startPotential, row.window.endPotential);
      const end = Math.max(row.window.startPotential, row.window.endPotential);
      for (const boundary of ["start", "end"] as const) {
        const y = boundary === "start" ? start : end;
        shapes.push({
          type: "line",
          xref: "paper",
          yref: "y",
          x0: 0,
          x1: 1,
          y0: y,
          y1: y,
          line: { color: row.dataset.color, width: 1.5, dash: boundary === "start" ? "dot" : "dash" },
          editable: true
        });
        meta.push({ datasetId: row.dataset.id, boundary });
      }
    }
    return { shapes, meta };
  }, [fitRows]);

  const tafelTraces = useMemo(() => {
    const pointTraces = tafelPointSeries.map(({ dataset, points }) => ({
      x: points.map((point) => Math.log10(Math.abs(point.yValue))),
      y: points.map((point) => point.correctedPotential),
      customdata: points.map((point) => [point.yValue]),
      type: "scatter",
      mode: "markers",
      name: dataset.displayName,
      showlegend: false,
      marker: { color: dataset.color, size: 5, opacity: 0.86 },
      hovertemplate: `log10(|j|)=%{x:.4f}<br>E=%{y:.5f} V<extra></extra>`,
      hoverlabel: hoverLabel(dataset.color)
    }));
    const fitTraces = fits.map((fit) => {
      const source = tafelPointSeries.find((series) => series.dataset.id === fit.datasetId);
      const color = source?.dataset.color ?? "#172026";
      const fitXs =
        source?.points
          .filter(
            (point) =>
              point.correctedPotential >= fit.startPotential &&
              point.correctedPotential <= fit.endPotential
          )
          .map((point) => Math.log10(Math.abs(point.yValue))) ?? [];
      const minX = fitXs.length ? Math.min(...fitXs) : -1;
      const maxX = fitXs.length ? Math.max(...fitXs) : 1;
      return {
        x: [minX, maxX],
        y: [
          fit.intercept + (fit.slopeMvDec / 1000) * minX,
          fit.intercept + (fit.slopeMvDec / 1000) * maxX
        ],
        type: "scatter",
        mode: "lines",
        name: `${fit.displayName} fit`,
        showlegend: false,
        line: { color, width: 2, dash: "dash" },
        hovertemplate: `${t("slope")}=${fit.slopeMvDec.toFixed(1)} mV/dec<br>R²=${fit.r2.toFixed(4)}<extra></extra>`,
        hoverlabel: hoverLabel(color)
      };
    });
    const traces = [...pointTraces, ...fitTraces];
    return hoverPoint?.panel === "tafel" ? [...traces, hoverTrace(hoverPoint)] : traces;
  }, [tafelPointSeries, fits, hoverPoint, t]);

  const tafelFocusRange = useMemo(() => {
    if (!tafelFocus || fits.length === 0) return undefined;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const fit of fits) {
      const source = tafelPointSeries.find((series) => series.dataset.id === fit.datasetId);
      if (!source) continue;
      for (const point of source.points) {
        if (
          point.correctedPotential >= fit.startPotential &&
          point.correctedPotential <= fit.endPotential
        ) {
          const x = Math.log10(Math.abs(point.yValue));
          xs.push(x);
          ys.push(point.correctedPotential);
        }
      }
    }
    if (xs.length < 2 || ys.length < 2) return undefined;
    return paddedRange(xs, ys);
  }, [tafelFocus, fits, tafelPointSeries]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    try {
      const parsed = await parseFiles(Array.from(files), datasets.length);
      setDatasets((current) => [...current, ...parsed]);
      const allPoints = parsed.flatMap((dataset) => correctDataset(dataset, settings));
      if (allPoints.length) setFitRange(normalizeFitRange(inferDefaultFitRange(allPoints)));
    } catch (err) {
      setError(`${t("parseError")}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function handleExportReimport() {
    if (!orderedDatasets.length) return;
    const series = orderedDatasets.map((dataset) => ({
      dataset,
      points: correctedMap.get(dataset.id) ?? []
    }));
    downloadText(reimportFileName(), reimportCsv(series, allYLabel), "text/csv;charset=utf-8");
  }

  function updateSettings<K extends keyof CorrectionSettings>(key: K, value: CorrectionSettings[K]) {
    const patch = sanitizeCorrectionPatch({ [key]: value } as Partial<CorrectionSettings>);
    setSettings((current) => ({ ...current, [key]: (patch[key] ?? value) as CorrectionSettings[K] }));
  }

  function updateDataset(id: string, patch: Partial<Dataset>) {
    setDatasets((current) =>
      current.map((dataset) => (dataset.id === id ? { ...dataset, ...patch } : dataset))
    );
  }

  function updateOverride(id: string, patch: Partial<CorrectionSettings>) {
    setDatasets((current) =>
      current.map((dataset) =>
        dataset.id === id
          ? { ...dataset, override: { ...settings, ...dataset.override, ...sanitizeCorrectionPatch(patch) } }
          : dataset
      )
    );
  }

  function resetOverride(id: string) {
    setDatasets((current) =>
      current.map((dataset) => (dataset.id === id ? { ...dataset, override: undefined } : dataset))
    );
  }

  function toggleDatasetVisibility(id: string) {
    setDatasets((current) =>
      current.map((dataset) =>
        dataset.id === id ? { ...dataset, visible: !dataset.visible } : dataset
      )
    );
  }

  function reorderDataset(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    setDatasets((current) => {
      const ordered = [...current].sort((a, b) => a.order - b.order);
      const from = ordered.findIndex((dataset) => dataset.id === sourceId);
      const to = ordered.findIndex((dataset) => dataset.id === targetId);
      if (from < 0 || to < 0) return current;
      const [moved] = ordered.splice(from, 1);
      ordered.splice(to, 0, moved);
      return ordered.map((dataset, order) => ({ ...dataset, order }));
    });
  }

  function runFits() {
    const window = normalizeFitWindow({
      startPotential: fitRange.start,
      endPotential: fitRange.end
    });
    setFitWindows((current) => {
      const next = { ...current };
      for (const { dataset } of lsvSeries) next[dataset.id] = window;
      return next;
    });
    setTafelFocus(true);
    const validFitCount = lsvSeries.filter(({ dataset, points }) =>
      linearTafelFit(dataset.id, dataset.displayName, points, window.startPotential, window.endPotential)
    ).length;
    if (!validFitCount) {
      setError(t("invalidFit"));
      return;
    }
    setError("");
  }

  function updateFitWindow(datasetId: string, patch: Partial<TafelFitWindow>) {
    setFitWindows((current) => {
      const currentWindow = current[datasetId] ?? {
        startPotential: fitRange.start,
        endPotential: fitRange.end
      };
      return {
        ...current,
        [datasetId]: normalizeFitWindow({ ...currentWindow, ...patch })
      };
    });
    setTafelFocus(true);
  }

  function handleTafelRelayout(event: any) {
    const updates = new Map<string, Partial<TafelFitWindow>>();
    for (const [key, rawValue] of Object.entries(event ?? {})) {
      const match = key.match(/^shapes\[(\d+)\]\.y[01]$/);
      if (!match) continue;
      const meta = tafelRangeOverlay.meta[Number(match[1])];
      const value = Number(rawValue);
      if (!meta || !Number.isFinite(value)) continue;
      const update = updates.get(meta.datasetId) ?? {};
      if (meta.boundary === "start") update.startPotential = value;
      else update.endPotential = value;
      updates.set(meta.datasetId, update);
    }
    if (!updates.size) return;
    setFitWindows((current) => {
      const next = { ...current };
      for (const [datasetId, patch] of updates) {
        const currentWindow = current[datasetId] ?? {
          startPotential: fitRange.start,
          endPotential: fitRange.end
        };
        next[datasetId] = normalizeFitWindow({ ...currentWindow, ...patch });
      }
      return next;
    });
    setTafelFocus(true);
  }

  async function exportPlot(
    ref: React.RefObject<HTMLElement>,
    filename: string,
    format: ImageFormat,
    options: { fits?: TafelFit[] } = {}
  ) {
    if (!ref.current) return;
    const source = ref.current as any;
    const data = exportTraces(source.data ?? []);
    const extraAnnotations = options.fits?.length ? fitSummaryAnnotations(options.fits, t) : [];
    const layout = {
      ...(source.layout ?? {}),
      showlegend: data.some((trace: any) => trace.showlegend),
      legend: {
        orientation: "h",
        x: 0,
        xanchor: "left",
        y: 1.18,
        yanchor: "bottom",
        bgcolor: "rgba(255,255,255,0)"
      },
      margin: {
        ...((source.layout ?? {}).margin ?? {}),
        t: 110,
        b: options.fits?.length ? 180 : ((source.layout ?? {}).margin?.b ?? 70)
      },
      annotations: [...(((source.layout ?? {}).annotations as any[]) ?? []), ...extraAnnotations]
    };
    const holder = document.createElement("div");
    holder.style.position = "fixed";
    holder.style.left = "-10000px";
    holder.style.top = "0";
    holder.style.width = "1800px";
    holder.style.height = `${options.fits?.length ? 1280 : 1100}px`;
    document.body.appendChild(holder);
    await Plotly.newPlot(holder, data, layout as any, { staticPlot: true, displaylogo: false } as any);
    await Plotly.downloadImage(holder, {
      format,
      filename,
      width: 1800,
      height: options.fits?.length ? 1280 : 1100,
      scale: format === "png" ? 2 : 1
    });
    Plotly.purge(holder);
    holder.remove();
  }

  function handleHover(panel: PlotPanel, event: any) {
    const point = event.points?.[0];
    if (!point) return;
    const data = point.data ?? {};
    const color = data.line?.color ?? data.marker?.color ?? "#0f766e";
    setHoverPoint({ panel, x: Number(point.x), y: Number(point.y), color });
  }

  function handleUnhover(panel: PlotPanel) {
    setHoverPoint((current) => (current?.panel === panel ? null : current));
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#eef1ec] px-4 py-4 text-ink md:px-6">
      <header className="mb-4 flex flex-col gap-3 rounded-lg border border-line bg-white px-4 py-3 shadow-soft lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-normal">{t("appTitle")}</h1>
          <p className="text-sm text-slate-500">
            {t("appSubtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="primary-button cursor-pointer">
            <FileUp size={16} />
            {t("importFiles")}
            <input
              className="hidden"
              type="file"
              multiple
              accept=".mpr,.mpt,.txt,.csv"
              onChange={(event) => void handleFiles(event.target.files)}
            />
          </label>
          <button
            className="toolbar-button"
            onClick={handleExportReimport}
            disabled={!orderedDatasets.length}
          >
            <Download size={16} />
            {t("exportReimport")}
          </button>
          <button
            className="toolbar-button"
            onClick={() => setLanguage((current) => (current === "zh" ? "en" : "zh"))}
          >
            <Languages size={16} />
            {language === "zh" ? "English" : "中文"}
          </button>
          <button
            className="danger-button"
            onClick={() => {
              setDatasets([]);
              setFitWindows({});
              setHoverPoint(null);
            }}
          >
            <Trash2 size={16} />
            {t("clear")}
          </button>
        </div>
      </header>

      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section className="grid min-w-0 gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="grid min-w-0 content-start gap-4">
          <Panel title={t("files")}>
            <DatasetTable
              datasets={orderedDatasets}
              dragId={dragId}
              setDragId={setDragId}
              t={t}
              onUpdate={updateDataset}
              onReorder={reorderDataset}
            />
          </Panel>

          <Panel title={t("corrections")}>
            <CorrectionEditor settings={settings} t={t} onChange={updateSettings} />
          </Panel>

          <Panel title={t("display")}>
            <div className="space-y-3">
              <Field label={t("cycleDisplay")}>
                <div className="segmented grid-cols-3">
                  {[
                    ["last", t("lastCycle")],
                    ["last3", t("lastThree")],
                    ["all", t("allCycles")]
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      data-active={cycleMode === value}
                      onClick={() => setCycleMode(value as CycleDisplayMode)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
              <label className="flex items-center justify-between rounded-md border border-line bg-panel px-3 py-2 text-sm">
                <span>{t("stacked")}</span>
                <input
                  type="checkbox"
                  checked={stacked}
                  onChange={(event) => setStacked(event.target.checked)}
                />
              </label>
              <label className="flex items-center justify-between rounded-md border border-line bg-panel px-3 py-2 text-sm">
                <span>{t("showDirection")}</span>
                <input
                  type="checkbox"
                  checked={showDirection}
                  onChange={(event) => setShowDirection(event.target.checked)}
                />
              </label>
              <NumberField label={t("stackStep")} value={stackStep} onChange={setStackStep} />
              <button className="toolbar-button w-full" onClick={() => setSettingsOpen(true)}>
                <Settings2 size={16} />
                {t("plotSettings")}
              </button>
            </div>
          </Panel>
        </aside>

        <section className="grid min-w-0 gap-4">
          <div className="panel min-w-0 p-3">
            <div className="segmented mb-3 grid max-w-md grid-cols-2">
              <button data-active={activePanel === "cv"} onClick={() => setActivePanel("cv")}>
                {t("cvPanel")}
              </button>
              <button data-active={activePanel === "tafel"} onClick={() => setActivePanel("tafel")}>
                {t("tafelPanel")}
              </button>
            </div>

            {activePanel === "cv" ? (
              <div className="space-y-3">
                <PlotToolbar
                  title={t("cvPanel")}
                  datasets={orderedDatasets}
                  t={t}
                  onToggleDataset={toggleDatasetVisibility}
                  onExportCsv={() =>
                    downloadWorkbook(
                      "cv-current-view.xls",
                      pointsWorkbook(
                        orderedDatasets,
                        cvSeries.map(({ dataset, points }) => ({ dataset, points })),
                        yLabel
                      )
                    )
                  }
                  onExportPng={() => void exportPlot(cvPlotRef, "cv-current-view", "png")}
                  onExportSvg={() => void exportPlot(cvPlotRef, "cv-current-view", "svg")}
                />
                <Plot
                  data={cvTraces as any}
                  layout={{
                    autosize: true,
                    height: 460,
                    paper_bgcolor: "#ffffff",
                    plot_bgcolor: "#fbfcfa",
                    margin: { l: 72, r: 28, t: 18, b: 64 },
                    xaxis: { title: { text: xLabel }, zeroline: false, gridcolor: "#e6ebe6" },
                    yaxis: { title: { text: yLabel }, zeroline: true, gridcolor: "#e6ebe6" },
                    showlegend: false,
                    hovermode: "closest",
                    uirevision: cvUiRevision,
                    annotations: cvDirectionAnnotations as any,
                    font: { family: "Inter, Arial, sans-serif", color: "#172026" }
                  }}
                  config={{ responsive: true, displaylogo: false, scrollZoom: true, modeBarButtonsToRemove: ["lasso2d"] }}
                  style={{ width: "100%", height: "460px" }}
                  onInitialized={(_, graphDiv) => {
                    cvPlotRef.current = graphDiv as unknown as HTMLElement;
                  }}
                  onHover={(event) => handleHover("cv", event)}
                  onUnhover={() => handleUnhover("cv")}
                />
                <CvParameterTable
                  datasets={orderedDatasets}
                  settings={settings}
                  t={t}
                  onOverride={updateOverride}
                  onResetOverride={resetOverride}
                />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-[170px_1fr_1fr_140px_140px]">
                  <Field label={t("branch")}>
                    <select
                      className="number-input"
                      value={branchMode}
                      onChange={(event) => setBranchMode(event.target.value as BranchMode)}
                    >
                      <option value="forward">{t("forward")}</option>
                      <option value="reverse">{t("reverse")}</option>
                      <option value="all">{t("allBranch")}</option>
                    </select>
                  </Field>
                  <NumberField
                    label={t("fitStart")}
                    value={fitRange.start}
                    onChange={(value) => setFitRange((range) => ({ ...range, start: value }))}
                    precision={FIT_POTENTIAL_DECIMALS}
                  />
                  <NumberField
                    label={t("fitEnd")}
                    value={fitRange.end}
                    onChange={(value) => setFitRange((range) => ({ ...range, end: value }))}
                    precision={FIT_POTENTIAL_DECIMALS}
                  />
                  <div className="flex items-end">
                    <button className="primary-button w-full" onClick={runFits}>
                      {t("fitAll")}
                    </button>
                  </div>
                  <div className="flex items-end">
                    <button
                      className="toolbar-button w-full"
                      onClick={() => setTafelFocus((current) => !current)}
                      disabled={!fits.length}
                    >
                      {tafelFocus ? t("fullRange") : t("fitFocus")}
                    </button>
                  </div>
                </div>
                <p className="text-xs text-slate-500">{t("tafelNote")}</p>
                <FormulaCard title={t("tafelFormulaTitle")}>
                  <div>{t("tafelFormula")}</div>
                </FormulaCard>

                <PlotToolbar
                  title="LSV"
                  datasets={orderedDatasets}
                  t={t}
                  onToggleDataset={toggleDatasetVisibility}
                  onExportCsv={() =>
                    downloadWorkbook("lsv-current-view.xls", pointsWorkbook(orderedDatasets, lsvSeries, yLabel))
                  }
                  onExportPng={() => void exportPlot(lsvPlotRef, "lsv-current-view", "png")}
                  onExportSvg={() => void exportPlot(lsvPlotRef, "lsv-current-view", "svg")}
                />
                <Plot
                  data={lsvTraces as any}
                  layout={{
                    autosize: true,
                    height: 300,
                    dragmode: "select",
                    paper_bgcolor: "#ffffff",
                    plot_bgcolor: "#fbfcfa",
                    margin: { l: 72, r: 28, t: 18, b: 58 },
                    xaxis: { title: { text: xLabel }, gridcolor: "#e6ebe6" },
                    yaxis: { title: { text: yLabel }, gridcolor: "#e6ebe6" },
                    shapes: [
                      {
                        type: "rect",
                        xref: "x",
                        yref: "paper",
                        x0: Math.min(fitRange.start, fitRange.end),
                        x1: Math.max(fitRange.start, fitRange.end),
                        y0: 0,
                        y1: 1,
                        fillcolor: "rgba(15, 118, 110, 0.08)",
                        line: { color: "rgba(15, 118, 110, 0.28)", width: 1 }
                      }
                    ],
                    showlegend: false,
                    uirevision: lsvUiRevision,
                    font: { family: "Inter, Arial, sans-serif", color: "#172026" }
                  }}
                  config={{ responsive: true, displaylogo: false, scrollZoom: true }}
                  style={{ width: "100%", height: "300px" }}
                  onInitialized={(_, graphDiv) => {
                    lsvPlotRef.current = graphDiv as unknown as HTMLElement;
                  }}
                  onSelected={(event) => {
                    const xs =
                      (event as any)?.points
                        ?.map((point: { x: unknown }) => Number(point.x))
                        .filter(Number.isFinite) ?? [];
                    if (xs.length) {
                      setFitRange(normalizeFitRange({ start: Math.min(...xs), end: Math.max(...xs) }));
                    }
                  }}
                  onHover={(event) => handleHover("lsv", event)}
                  onUnhover={() => handleUnhover("lsv")}
                />

                <PlotToolbar
                  title="Tafel"
                  datasets={orderedDatasets}
                  t={t}
                  onToggleDataset={toggleDatasetVisibility}
                  onExportCsv={() =>
                    downloadWorkbook("tafel-current-view.xls", tafelWorkbook(tafelPointSeries, fits))
                  }
                  onExportPng={() => void exportPlot(tafelPlotRef, "tafel-current-view", "png", { fits })}
                  onExportSvg={() => void exportPlot(tafelPlotRef, "tafel-current-view", "svg", { fits })}
                />
                <Plot
                  data={tafelTraces as any}
                  layout={{
                    autosize: true,
                    height: 330,
                    paper_bgcolor: "#ffffff",
                    plot_bgcolor: "#fbfcfa",
                    margin: { l: 72, r: 28, t: 18, b: 58 },
                    xaxis: {
                      title: { text: t("logAxis") },
                      gridcolor: "#e6ebe6",
                      range: tafelFocusRange?.x
                    },
                    yaxis: {
                      title: { text: xLabel },
                      gridcolor: "#e6ebe6",
                      range: tafelFocusRange?.y
                    },
                    shapes: tafelRangeOverlay.shapes,
                    showlegend: false,
                    uirevision: tafelUiRevision,
                    font: { family: "Inter, Arial, sans-serif", color: "#172026" }
                  }}
                  config={{
                    responsive: true,
                    displaylogo: false,
                    scrollZoom: true,
                    edits: { shapePosition: true }
                  }}
                  style={{ width: "100%", height: "330px" }}
                  onInitialized={(_, graphDiv) => {
                    tafelPlotRef.current = graphDiv as unknown as HTMLElement;
                  }}
                  onRelayout={handleTafelRelayout}
                  onHover={(event) => handleHover("tafel", event)}
                  onUnhover={() => handleUnhover("tafel")}
                />
                <FitTable rows={fitRows} globalRange={fitRange} t={t} onWindowChange={updateFitWindow} />
              </div>
            )}
          </div>
        </section>
      </section>

      {settingsOpen ? (
        <div className="fixed inset-0 z-20 grid place-items-center bg-slate-950/35 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-4 shadow-soft">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">{t("plotSettings")}</h2>
              <button className="toolbar-button" onClick={() => setSettingsOpen(false)}>
                OK
              </button>
            </div>
            <p className="text-sm text-slate-600">
              {language === "zh"
                ? "图例位于绘图区上方，图像与数据均按当前图单独导出。后续可继续扩展期刊模板、坐标范围和字体。"
                : "Legends sit above the plot area. Images and data export per plot. Journal templates, axis ranges, and fonts can be expanded later."}
            </p>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function DatasetTable({
  datasets,
  dragId,
  setDragId,
  t,
  onUpdate,
  onReorder
}: {
  datasets: Dataset[];
  dragId: string | null;
  setDragId: (id: string | null) => void;
  t: (key: string) => string;
  onUpdate: (id: string, patch: Partial<Dataset>) => void;
  onReorder: (sourceId: string, targetId: string) => void;
}) {
  if (!datasets.length) {
    return (
      <div className="rounded-md border border-dashed border-line bg-panel p-3 text-sm text-slate-500">
        {t("noData")}
      </div>
    );
  }

  return (
    <div>
      <p className="mb-2 text-xs text-slate-500">{t("dragSortHint")}</p>
      <div className="max-h-[320px] overflow-y-auto rounded-md border border-line">
        <table className="w-full table-fixed text-left text-xs">
          <thead className="sticky top-0 bg-panel text-slate-600">
            <tr>
              <th className="w-8 px-2 py-2"></th>
              <th className="w-14 px-2 py-2">{t("color")}</th>
              <th className="px-2 py-2">{t("rename")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-white">
            {datasets.map((dataset) => (
              <tr
                key={dataset.id}
                draggable
                className={dragId === dataset.id ? "bg-teal-50" : ""}
                onDragStart={() => setDragId(dataset.id)}
                onDragEnd={() => setDragId(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragId) onReorder(dragId, dataset.id);
                  setDragId(null);
                }}
              >
                <td className="px-2 py-2 text-slate-400">
                  <GripVertical size={14} />
                </td>
                <td className="px-2 py-2">
                  <input
                    className="h-7 w-8 rounded border border-line"
                    type="color"
                    value={dataset.color}
                    onChange={(event) => onUpdate(dataset.id, { color: event.target.value })}
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    className="number-input h-8 w-48"
                    value={dataset.displayName}
                    onChange={(event) => onUpdate(dataset.id, { displayName: event.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CorrectionEditor({
  settings,
  t,
  onChange
}: {
  settings: CorrectionSettings;
  t: (key: string) => string;
  onChange: <K extends keyof CorrectionSettings>(key: K, value: CorrectionSettings[K]) => void;
}) {
  return (
    <div className="space-y-3">
      <FormulaCard title={t("correctionFormulaTitle")}>
        <div>{t("potentialFormula")}</div>
        <div>{t("currentFormula")}</div>
        <div title={t("massTooltip")}>{t("massFormula")}</div>
      </FormulaCard>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("reference")} className="col-span-2">
          <ReferenceSelect value={settings.referenceId} onChange={(value) => onChange("referenceId", value)} />
        </Field>
        <NumberField label={t("customRef")} value={settings.customReferenceVsShe} onChange={(value) => onChange("customReferenceVsShe", value)} />
        <NumberField label={t("referenceOffset")} value={settings.referenceOffset} onChange={(value) => onChange("referenceOffset", value)} />
        <NumberField label={t("pH")} value={settings.pH} onChange={(value) => onChange("pH", value)} constraint="nonNegative" />
        <NumberField label={t("resistance")} value={settings.resistanceOhm} onChange={(value) => onChange("resistanceOhm", value)} constraint="nonNegative" />
        <NumberField label={t("irPercent")} value={settings.irPercent} onChange={(value) => onChange("irPercent", value)} constraint="nonNegative" />
        <Field label={t("normMode")} title={t("massTooltip")}>
          <NormalizeSelect value={settings.normalizeMode} t={t} onChange={(value) => onChange("normalizeMode", value)} title={t("massTooltip")} />
        </Field>
        <NumberField label={t("geoArea")} value={settings.geometricAreaCm2} onChange={(value) => onChange("geometricAreaCm2", value)} constraint="nonNegative" />
        <NumberField label={t("ecsaArea")} value={settings.ecsaCm2} onChange={(value) => onChange("ecsaCm2", value)} constraint="nonNegative" />
        <NumberField label={t("loading")} value={settings.loadingMgCm2} onChange={(value) => onChange("loadingMgCm2", value)} constraint="nonNegative" title={t("massTooltip")} />
      </div>
    </div>
  );
}

function CvParameterTable({
  datasets,
  settings,
  t,
  onOverride,
  onResetOverride
}: {
  datasets: Dataset[];
  settings: CorrectionSettings;
  t: (key: string) => string;
  onOverride: (id: string, patch: Partial<CorrectionSettings>) => void;
  onResetOverride: (id: string) => void;
}) {
  if (!datasets.length) return null;
  return (
    <section className="rounded-lg border border-line bg-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t("cvParameterTable")}</h2>
      </div>
      <div className="max-h-[330px] min-w-0 overflow-auto rounded-md border border-line bg-white">
        <table className="w-max min-w-full table-auto text-left text-xs">
          <thead className="sticky top-0 z-10 bg-panel text-slate-600">
            <tr>
              <th className="w-[340px] min-w-[220px] max-w-[340px] whitespace-normal px-2 py-2">{t("rename")}</th>
              <th className="min-w-[8rem] whitespace-nowrap px-2 py-2">{t("reference")}</th>
              <th className="min-w-[6rem] whitespace-nowrap px-2 py-2">{t("customRef")}</th>
              <th className="min-w-[6rem] whitespace-nowrap px-2 py-2">{t("referenceOffset")}</th>
              <th className="min-w-[5rem] whitespace-nowrap px-2 py-2">{t("pH")}</th>
              <th className="min-w-[5rem] whitespace-nowrap px-2 py-2">{t("resistance")}</th>
              <th className="min-w-[5rem] whitespace-nowrap px-2 py-2">{t("irPercent")}</th>
              <th className="min-w-[7rem] whitespace-nowrap px-2 py-2">{t("normMode")}</th>
              <th className="min-w-[5rem] whitespace-nowrap px-2 py-2">{t("geoArea")}</th>
              <th className="min-w-[5rem] whitespace-nowrap px-2 py-2">{t("ecsaArea")}</th>
              <th className="min-w-[5rem] whitespace-nowrap px-2 py-2">{t("loading")}</th>
              <th className="min-w-[5rem] whitespace-nowrap px-2 py-2">{t("status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {datasets.map((dataset) => {
              const active = mergedCorrection(settings, dataset.override);
              return (
                <tr key={dataset.id}>
                  <td className="w-[340px] min-w-[220px] max-w-[340px] whitespace-normal break-words px-2 py-2 align-top" title={dataset.displayName}>
                    {dataset.displayName}
                  </td>
                  <td className="px-2 py-2 align-top">
                    <ReferenceSelect
                      value={active.referenceId}
                      onChange={(value) => onOverride(dataset.id, { referenceId: value })}
                      compact
                    />
                  </td>
                  <td className="px-2 py-2 align-top">
                    <SmallNumber value={active.customReferenceVsShe} onChange={(value) => onOverride(dataset.id, { customReferenceVsShe: value })} widthClass="w-20" />
                  </td>
                  <td className="px-2 py-2 align-top">
                    <SmallNumber value={active.referenceOffset} onChange={(value) => onOverride(dataset.id, { referenceOffset: value })} widthClass="w-20" />
                  </td>
                  <td className="px-2 py-2 align-top">
                    <SmallNumber value={active.pH} onChange={(value) => onOverride(dataset.id, { pH: value })} constraint="nonNegative" widthClass="w-16" />
                  </td>
                  <td className="px-2 py-2 align-top">
                    <SmallNumber value={active.resistanceOhm} onChange={(value) => onOverride(dataset.id, { resistanceOhm: value })} constraint="nonNegative" widthClass="w-20" />
                  </td>
                  <td className="px-2 py-2 align-top">
                    <SmallNumber value={active.irPercent} onChange={(value) => onOverride(dataset.id, { irPercent: value })} constraint="nonNegative" widthClass="w-20" />
                  </td>
                  <td className="px-2 py-2 align-top">
                    <NormalizeSelect
                      value={active.normalizeMode}
                      t={t}
                      onChange={(value) => onOverride(dataset.id, { normalizeMode: value })}
                      compact
                      title={t("massTooltip")}
                    />
                  </td>
                  <td className="px-2 py-2 align-top">
                    <SmallNumber value={active.geometricAreaCm2} onChange={(value) => onOverride(dataset.id, { geometricAreaCm2: value })} constraint="nonNegative" widthClass="w-20" />
                  </td>
                  <td className="px-2 py-2 align-top">
                    <SmallNumber value={active.ecsaCm2} onChange={(value) => onOverride(dataset.id, { ecsaCm2: value })} constraint="nonNegative" widthClass="w-20" />
                  </td>
                  <td className="px-2 py-2 align-top">
                    <SmallNumber value={active.loadingMgCm2} onChange={(value) => onOverride(dataset.id, { loadingMgCm2: value })} constraint="nonNegative" title={t("massTooltip")} widthClass="w-20" />
                  </td>
                  <td className="px-2 py-2 align-top">
                    <button
                      className="toolbar-button h-7 px-2"
                      onClick={() => onResetOverride(dataset.id)}
                      disabled={!dataset.override}
                    >
                      {dataset.override ? t("reset") : t("global")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PlotToolbar({
  title,
  datasets,
  t,
  onToggleDataset,
  onExportCsv,
  onExportPng,
  onExportSvg
}: {
  title: string;
  datasets: Dataset[];
  t: (key: string) => string;
  onToggleDataset: (id: string) => void;
  onExportCsv: () => void;
  onExportPng: () => void;
  onExportSvg: () => void;
}) {
  const hasVisibleDataset = datasets.some((dataset) => dataset.visible);
  return (
    <div className="rounded-lg border border-line bg-panel px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="flex flex-wrap gap-2">
          <button className="toolbar-button h-8" onClick={onExportCsv} disabled={!hasVisibleDataset}>
            <Download size={14} />
            {t("exportCsv")}
          </button>
          <button className="toolbar-button h-8" onClick={onExportPng} disabled={!hasVisibleDataset}>
            {t("exportPng")}
          </button>
          <button className="toolbar-button h-8" onClick={onExportSvg} disabled={!hasVisibleDataset}>
            {t("exportSvg")}
          </button>
        </div>
      </div>
      <LegendBar datasets={datasets} t={t} onToggleDataset={onToggleDataset} />
    </div>
  );
}

function LegendBar({
  datasets,
  t,
  onToggleDataset
}: {
  datasets: Dataset[];
  t: (key: string) => string;
  onToggleDataset: (id: string) => void;
}) {
  if (!datasets.length) return null;
  return (
    <div className="mt-2 flex max-h-20 flex-wrap gap-x-3 gap-y-1 overflow-y-auto pr-1 text-xs text-slate-600">
      {datasets.map((dataset) => (
        <span
          key={dataset.id}
          className={`inline-flex max-w-[260px] items-center gap-1.5 rounded border border-transparent px-1 py-0.5 ${
            dataset.visible ? "" : "opacity-45"
          }`}
        >
          <button
            className="inline-flex h-5 w-5 items-center justify-center rounded border border-line bg-white text-slate-600 hover:border-mint hover:text-mint"
            onClick={() => onToggleDataset(dataset.id)}
            title={dataset.visible ? t("hide") : t("show")}
          >
            {dataset.visible ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
          <span
            className="h-2.5 w-5 shrink-0 rounded-full"
            style={{ backgroundColor: dataset.color }}
          />
          <span className="truncate">{dataset.displayName}</span>
        </span>
      ))}
    </div>
  );
}

function FitTable({
  rows,
  globalRange,
  t,
  onWindowChange
}: {
  rows: TafelFitRow[];
  globalRange: { start: number; end: number };
  t: (key: string) => string;
  onWindowChange: (datasetId: string, patch: Partial<TafelFitWindow>) => void;
}) {
  return (
    <section className="rounded-lg border border-line bg-panel p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("fitWindowTable")}</h2>
        <p className="text-xs text-slate-500">{t("fitWindowHint")}</p>
      </div>
      <div className="max-h-[240px] min-w-0 overflow-auto rounded-md border border-line bg-white">
        <table className="w-max min-w-[900px] whitespace-nowrap text-left text-xs">
          <thead className="sticky top-0 z-10 bg-panel text-slate-600">
            <tr>
              <th className="w-[340px] px-3 py-2">{t("rename")}</th>
              <th className="px-3 py-2">{t("fitStart")}</th>
              <th className="px-3 py-2">{t("fitEnd")}</th>
              <th className="px-3 py-2">{t("slope")}</th>
              <th className="px-3 py-2">{t("intercept")}</th>
              <th className="px-3 py-2">{t("r2")}</th>
              <th className="px-3 py-2">{t("nPoints")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length ? (
              rows.map((row) => {
                const hasWindow = Boolean(row.window);
                const window = row.window ?? {
                  startPotential: globalRange.start,
                  endPotential: globalRange.end
                };
                const fit = row.fit;
                const resultPlaceholder = hasWindow ? t("invalidFit") : t("emptyFit");
                return (
                <tr key={row.dataset.id}>
                  <td className="w-[340px] max-w-[340px] whitespace-normal break-words px-3 py-2">
                    {row.dataset.displayName}
                  </td>
                  <td className="px-3 py-2">
                    <SmallNumber
                      value={window?.startPotential ?? 0}
                      onChange={(value) => onWindowChange(row.dataset.id, { startPotential: value })}
                      precision={FIT_POTENTIAL_DECIMALS}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <SmallNumber
                      value={window?.endPotential ?? 0}
                      onChange={(value) => onWindowChange(row.dataset.id, { endPotential: value })}
                      precision={FIT_POTENTIAL_DECIMALS}
                    />
                  </td>
                  <td className="px-3 py-2">{fit ? `${fit.slopeMvDec.toFixed(2)} mV/dec` : resultPlaceholder}</td>
                  <td className="px-3 py-2">{fit ? `${fit.intercept.toFixed(5)} V` : "-"}</td>
                  <td className="px-3 py-2">{fit ? fit.r2.toFixed(5) : "-"}</td>
                  <td className="px-3 py-2">{fit ? fit.n : "-"}</td>
                </tr>
                );
              })
            ) : (
              <tr>
                <td className="px-2 py-3 text-slate-500" colSpan={7}>
                  {t("emptyFit")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReferenceSelect({
  value,
  onChange,
  compact = false
}: {
  value: ReferencePresetId;
  onChange: (value: ReferencePresetId) => void;
  compact?: boolean;
}) {
  return (
    <select
      className={compact ? "number-input h-8 w-32" : "number-input"}
      value={value}
      onChange={(event) => onChange(event.target.value as ReferencePresetId)}
    >
      {referencePresets.map((reference) => (
        <option key={reference.id} value={reference.id}>
          {reference.label}
        </option>
      ))}
    </select>
  );
}

function NormalizeSelect({
  value,
  t,
  onChange,
  compact = false,
  title
}: {
  value: NormalizeMode;
  t: (key: string) => string;
  onChange: (value: NormalizeMode) => void;
  compact?: boolean;
  title?: string;
}) {
  return (
    <select
      className={compact ? "number-input h-8 w-28" : "number-input"}
      value={value}
      title={title}
      onChange={(event) => onChange(event.target.value as NormalizeMode)}
    >
      <option value="raw">{t("rawCurrent")}</option>
      <option value="geo">{t("geo")}</option>
      <option value="ecsa">{t("ecsa")}</option>
      <option value="mass">{t("mass")}</option>
    </select>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel p-3">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">{title}</h2>
      {children}
    </section>
  );
}

function FormulaCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-white px-3 py-2 text-xs leading-5 text-slate-600">
      <div className="mb-1 font-semibold text-slate-700">{title}</div>
      <div className="space-y-1 font-mono">{children}</div>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
  title
}: {
  label: string;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <label className={className} title={title}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  constraint = "any",
  title,
  precision
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  constraint?: NumberConstraint;
  title?: string;
  precision?: number;
}) {
  return (
    <Field label={label} title={title}>
      <SmallNumber
        value={value}
        onChange={onChange}
        full
        constraint={constraint}
        title={title}
        precision={precision}
      />
    </Field>
  );
}

function SmallNumber({
  value,
  onChange,
  full = false,
  constraint = "any",
  title,
  widthClass = "w-24",
  precision
}: {
  value: number;
  onChange: (value: number) => void;
  full?: boolean;
  constraint?: NumberConstraint;
  title?: string;
  widthClass?: string;
  precision?: number;
}) {
  const [draft, setDraft] = useState(formatNumber(value, precision));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!dirty) {
      setDraft(formatNumber(value, precision));
      setError("");
    }
  }, [dirty, precision, value]);

  function commitDraft() {
    if (!dirty) return;
    const result = validateNumberDraft(draft, constraint);
    if (result.error) {
      setError(result.error);
      return;
    }
    setError("");
    setDirty(false);
    const nextValue = precision === undefined ? result.value : roundToPrecision(result.value, precision);
    setDraft(formatNumber(nextValue, precision));
    onChange(nextValue);
  }

  function resetDraft() {
    setDraft(formatNumber(value, precision));
    setDirty(false);
    setError("");
  }

  return (
    <div className={full ? "w-full" : widthClass}>
      <input
        className={`${full ? "number-input" : `number-input h-8 ${widthClass}`} ${
          error ? "border-red-300 bg-red-50 focus:border-red-400 focus:ring-red-100" : ""
        }`}
        type="text"
        inputMode="decimal"
        title={error || title}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setDirty(true);
          setError("");
        }}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitDraft();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            resetDraft();
            event.currentTarget.blur();
          }
        }}
      />
      {error ? <div className="mt-1 whitespace-normal text-[10px] leading-tight text-red-600">{error}</div> : null}
    </div>
  );
}

function groupByCycle(points: CorrectedPoint[]) {
  const map = new Map<number, CorrectedPoint[]>();
  for (const point of points) {
    if (!map.has(point.cycle)) map.set(point.cycle, []);
    map.get(point.cycle)!.push(point);
  }
  return map;
}

function hoverLabel(color: string) {
  return {
    bgcolor: "rgba(255,255,255,0.74)",
    bordercolor: color,
    font: { color, size: 12 }
  };
}

function hoverTrace(point: HoverPoint) {
  return {
    x: [point.x],
    y: [point.y],
    type: "scatter",
    mode: "markers",
    showlegend: false,
    hoverinfo: "skip",
    marker: {
      color: point.color,
      size: 12,
      line: { color: "#ffffff", width: 2 },
      opacity: 1
    }
  };
}

function formatNumber(value: number, precision?: number) {
  if (!Number.isFinite(value)) return "";
  if (precision === undefined) return String(value);
  return roundToPrecision(value, precision).toFixed(precision);
}

function validateNumberDraft(draft: string, constraint: NumberConstraint): { value: number; error?: string } {
  const trimmed = draft.trim();
  if (!trimmed) return { value: 0, error: "请输入数字 / Enter a number" };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { value: 0, error: "请输入有效数字 / Enter a valid number" };
  if (constraint === "positive" && value <= 0) {
    return { value, error: "必须为正数 / Must be > 0" };
  }
  if (constraint === "nonNegative" && value < 0) {
    return { value, error: "必须为非负数 / Must be >= 0" };
  }
  return { value };
}

function coerceNumber(value: number, constraint: NumberConstraint) {
  if (!Number.isFinite(value)) return constraint === "positive" ? 1 : 0;
  if (constraint === "positive") return value > 0 ? value : 1;
  if (constraint === "nonNegative") return value >= 0 ? value : 0;
  return value;
}

function sanitizeCorrectionPatch(patch: Partial<CorrectionSettings>) {
  const next = { ...patch };
  if ("resistanceOhm" in next && next.resistanceOhm !== undefined) {
    next.resistanceOhm = coerceNumber(next.resistanceOhm, "nonNegative");
  }
  if ("irPercent" in next && next.irPercent !== undefined) {
    next.irPercent = coerceNumber(next.irPercent, "nonNegative");
  }
  if ("pH" in next && next.pH !== undefined) {
    next.pH = coerceNumber(next.pH, "nonNegative");
  }
  for (const key of ["geometricAreaCm2", "ecsaCm2", "loadingMgCm2"] as const) {
    if (key in next && next[key] !== undefined) next[key] = coerceNumber(next[key]!, "nonNegative");
  }
  return next;
}

function normalizeFitWindow(window: TafelFitWindow): TafelFitWindow {
  const start = Number.isFinite(window.startPotential) ? window.startPotential : 0;
  const end = Number.isFinite(window.endPotential) ? window.endPotential : start;
  return {
    startPotential: roundFitPotential(Math.min(start, end)),
    endPotential: roundFitPotential(Math.max(start, end))
  };
}

function normalizeFitRange(range: { start: number; end: number }) {
  return {
    start: roundFitPotential(range.start),
    end: roundFitPotential(range.end)
  };
}

function roundFitPotential(value: number) {
  return roundToPrecision(value, FIT_POTENTIAL_DECIMALS);
}

function roundToPrecision(value: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function exportTraces(traces: any[]) {
  const seen = new Set<string>();
  return traces
    .filter((trace) => !(trace?.hoverinfo === "skip" && !trace?.name))
    .map((trace) => {
      const clone = JSON.parse(JSON.stringify(trace));
      const name = String(clone.name ?? "");
      clone.showlegend = Boolean(name) && !seen.has(name);
      if (name) seen.add(name);
      return clone;
    });
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function fitSummaryAnnotations(fits: TafelFit[], t: (key: string) => string) {
  const text = fits
    .map(
      (fit) =>
        `${escapeHtml(fit.displayName)}: E ${fit.startPotential.toFixed(3)}-${fit.endPotential.toFixed(3)} V, ` +
        `${t("slope")} ${fit.slopeMvDec.toFixed(2)} mV/dec, ${t("r2")} ${fit.r2.toFixed(4)}, n=${fit.n}`
    )
    .join("<br>");
  return [
    {
      xref: "paper",
      yref: "paper",
      x: 0,
      y: -0.34,
      xanchor: "left",
      yanchor: "top",
      align: "left",
      text,
      showarrow: false,
      bgcolor: "rgba(255,255,255,0.92)",
      bordercolor: "#dfe4df",
      borderpad: 6,
      font: { size: 12, color: "#172026" }
    }
  ];
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function directionAnnotationsFor(points: CorrectedPoint[], offset: number) {
  if (points.length < 24) return [];
  const fractions = [0.34, 0.58, 0.78];
  const span = Math.max(6, Math.min(36, Math.floor(points.length * 0.012)));
  return fractions
    .map((fraction) => {
      const index = Math.min(points.length - span - 1, Math.max(1, Math.floor(points.length * fraction)));
      const from = points[index];
      const to = points[index + span];
      const x0 = from.correctedPotential;
      const y0 = from.yValue + offset;
      const x1 = to.correctedPotential;
      const y1 = to.yValue + offset;
      if (![x0, y0, x1, y1].every(Number.isFinite) || (x0 === x1 && y0 === y1)) return null;
      return {
        x: x1,
        y: y1,
        ax: x0,
        ay: y0,
        xref: "x",
        yref: "y",
        axref: "x",
        ayref: "y",
        text: "",
        showarrow: true,
        arrowhead: 3,
        arrowsize: 1,
        arrowwidth: 2,
        arrowcolor: "#9ca3af",
        opacity: 0.82
      };
    })
    .filter(Boolean);
}

function paddedRange(xs: number[], ys: number[]) {
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const padX = Math.max((maxX - minX) * 0.12, 0.05);
  const padY = Math.max((maxY - minY) * 0.12, 0.01);
  return {
    x: [minX - padX, maxX + padX] as [number, number],
    y: [minY - padY, maxY + padY] as [number, number]
  };
}
