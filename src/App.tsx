import Plot from "react-plotly.js";
import Plotly from "plotly.js-dist-min";
import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Download,
  Eye,
  EyeOff,
  FileDown,
  FileUp,
  Languages,
  RotateCcw,
  Settings2,
  Trash2
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { defaultCorrection, referencePresets } from "./lib/constants";
import { correctedCsv, downloadText, fitCsv } from "./lib/export";
import { makeT } from "./lib/i18n";
import {
  correctDataset,
  inferDefaultFitRange,
  linearTafelFit,
  selectBranch,
  selectCycles,
  yAxisKey
} from "./lib/math";
import { cycleCount, parseFiles } from "./lib/parser";
import type {
  BranchMode,
  CorrectedPoint,
  CorrectionSettings,
  CycleDisplayMode,
  Dataset,
  Language,
  NormalizeMode,
  ReferencePresetId,
  TafelFit
} from "./lib/types";

const sampleFiles = [
  "C:\\Users\\Xin\\Desktop\\(0_5M sodium carbonate  pH=11 with 0_1M Glucose)-S1-FTO-100nm 80Au20Pd GREY-0_225cm2_C01.mpr",
  "C:\\Users\\Xin\\Desktop\\(0_5M sodium carbonate  pH=11 with 0_1M Glucose)-S1-NaOH modified Ti foil-100nm 80Au20Pd-Black polish covered-0_14cm2_C01.mpr",
  "C:\\Users\\Xin\\Desktop\\CV 10mV 1M KOH 100mM EG Ni30S5.txt",
  "C:\\Users\\Xin\\Desktop\\CV 10mV 1M KOH 100mM EG Ni30S6.txt"
];

export default function App() {
  const [language, setLanguage] = useState<Language>("zh");
  const [activePanel, setActivePanel] = useState<"cv" | "tafel">("cv");
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [settings, setSettings] = useState<CorrectionSettings>(defaultCorrection);
  const [cycleMode, setCycleMode] = useState<CycleDisplayMode>("last");
  const [branchMode, setBranchMode] = useState<BranchMode>("forward");
  const [stacked, setStacked] = useState(false);
  const [stackStep, setStackStep] = useState(10);
  const [fitRange, setFitRange] = useState({ start: 0, end: 1 });
  const [fits, setFits] = useState<TafelFit[]>([]);
  const [readout, setReadout] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const cvPlotRef = useRef<HTMLElement | null>(null);
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

  const yLabel = t(yAxisKey(settings.normalizeMode));

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    try {
      const parsed = await parseFiles(Array.from(files), datasets.length);
      setDatasets((current) => [...current, ...parsed]);
      const allPoints = parsed.flatMap((dataset) => correctDataset(dataset, settings));
      if (allPoints.length) setFitRange(inferDefaultFitRange(allPoints));
    } catch (err) {
      setError(`${t("parseError")}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function updateSettings<K extends keyof CorrectionSettings>(key: K, value: CorrectionSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function updateDataset(id: string, patch: Partial<Dataset>) {
    setDatasets((current) =>
      current.map((dataset) => (dataset.id === id ? { ...dataset, ...patch } : dataset))
    );
  }

  function moveDataset(id: string, direction: -1 | 1) {
    setDatasets((current) => {
      const ordered = [...current].sort((a, b) => a.order - b.order);
      const index = ordered.findIndex((dataset) => dataset.id === id);
      const swapIndex = index + direction;
      if (index < 0 || swapIndex < 0 || swapIndex >= ordered.length) return current;
      const a = ordered[index];
      const b = ordered[swapIndex];
      return current.map((dataset) => {
        if (dataset.id === a.id) return { ...dataset, order: b.order };
        if (dataset.id === b.id) return { ...dataset, order: a.order };
        return dataset;
      });
    });
  }

  function updateOverride(id: string, patch: Partial<CorrectionSettings>) {
    setDatasets((current) =>
      current.map((dataset) =>
        dataset.id === id
          ? { ...dataset, override: { ...settings, ...dataset.override, ...patch } }
          : dataset
      )
    );
  }

  function runFits() {
    const nextFits = lsvSeries
      .map(({ dataset, points }) =>
        linearTafelFit(dataset.id, dataset.displayName, points, fitRange.start, fitRange.end)
      )
      .filter((fit): fit is TafelFit => fit !== null);
    setFits(nextFits);
    if (!nextFits.length) setError(language === "zh" ? "拟合窗口内有效点不足。" : "Not enough valid points in fit window.");
  }

  function exportCorrectedData() {
    downloadText(
      "cv-analyzer-corrected-data.csv",
      correctedCsv(orderedDatasets, correctedMap),
      "text/csv;charset=utf-8"
    );
  }

  function exportFitData() {
    downloadText("cv-analyzer-tafel-fits.csv", fitCsv(fits), "text/csv;charset=utf-8");
  }

  async function exportCurrentPlot() {
    if (!cvPlotRef.current) return;
    await Plotly.downloadImage(cvPlotRef.current, {
      format: "png",
      filename: activePanel === "cv" ? "cv-curves" : "lsv-tafel-curves",
      width: 1800,
      height: 1100,
      scale: 2
    });
  }

  const cvTraces = cvSeries.flatMap(({ dataset, points, offset }) => {
    const byCycle = groupByCycle(points);
    return Array.from(byCycle.entries()).flatMap(([cycle, cyclePoints]) => {
      const name =
        cycleMode === "last" ? dataset.displayName : `${dataset.displayName} C${cycle}`;
      const baseTrace = {
        x: cyclePoints.map((point) => point.correctedPotential),
        y: cyclePoints.map((point) => point.yValue + offset),
        type: "scatter",
        mode: "lines",
        name,
        line: { color: dataset.color, width: 2 },
        hovertemplate: `${name}<br>E=%{x:.4f} V<br>Y=%{y:.4g}<extra></extra>`
      };
      const directionPoint = cyclePoints[Math.floor(cyclePoints.length * 0.72)];
      const directionTrace =
        directionPoint && cyclePoints.length > 20
          ? {
              x: [directionPoint.correctedPotential],
              y: [directionPoint.yValue + offset],
              type: "scatter",
              mode: "markers",
              name: `${name} ${t("direction")}`,
              showlegend: false,
              marker: { color: dataset.color, size: 10, symbol: "triangle-right" },
              hoverinfo: "skip"
            }
          : null;
      return directionTrace ? [baseTrace, directionTrace] : [baseTrace];
    });
  });

  const lsvTraces = lsvSeries.map(({ dataset, points }) => ({
    x: points.map((point) => point.correctedPotential),
    y: points.map((point) => point.yValue),
    type: "scatter",
    mode: "lines+markers",
    name: dataset.displayName,
    line: { color: dataset.color, width: 2 },
    marker: { color: dataset.color, size: 4 },
    hovertemplate: `${dataset.displayName}<br>E=%{x:.4f} V<br>Y=%{y:.4g}<extra></extra>`
  }));

  const tafelTraces = [
    ...lsvSeries.map(({ dataset, points }) => ({
      x: points.filter((point) => Math.abs(point.yValue) > 0).map((point) => Math.log10(Math.abs(point.yValue))),
      y: points.filter((point) => Math.abs(point.yValue) > 0).map((point) => point.correctedPotential),
      type: "scatter",
      mode: "markers",
      name: dataset.displayName,
      marker: { color: dataset.color, size: 5 },
      hovertemplate: `${dataset.displayName}<br>log|j|=%{x:.3f}<br>E=%{y:.4f} V<extra></extra>`
    })),
    ...fits.map((fit) => {
      const source = lsvSeries.find((series) => series.dataset.id === fit.datasetId);
      const color = source?.dataset.color ?? "#172026";
      const xs = source
        ? source.points
            .filter(
              (point) =>
                point.correctedPotential >= fit.startPotential &&
                point.correctedPotential <= fit.endPotential &&
                Math.abs(point.yValue) > 0
            )
            .map((point) => Math.log10(Math.abs(point.yValue)))
        : [];
      const minX = xs.length ? Math.min(...xs) : -1;
      const maxX = xs.length ? Math.max(...xs) : 1;
      return {
        x: [minX, maxX],
        y: [fit.intercept + fit.slopeMvDec / 1000 * minX, fit.intercept + fit.slopeMvDec / 1000 * maxX],
        type: "scatter",
        mode: "lines",
        name: `${fit.displayName} fit`,
        line: { color, width: 2, dash: "dash" },
        hovertemplate: `${fit.displayName}<br>${t("slope")}: ${fit.slopeMvDec.toFixed(1)} mV/dec<br>R²=${fit.r2.toFixed(4)}<extra></extra>`
      };
    })
  ];

  return (
    <main className="min-h-screen bg-[#eef1ec] px-4 py-4 text-ink md:px-6">
      <header className="mb-4 flex flex-col gap-3 rounded-lg border border-line bg-white px-4 py-3 shadow-soft lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-normal">{t("appTitle")}</h1>
          <p className="text-sm text-slate-500">{t("appSubtitle")}</p>
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
          <button className="toolbar-button" onClick={exportCorrectedData} disabled={!datasets.length}>
            <FileDown size={16} />
            {t("exportData")}
          </button>
          <button className="toolbar-button" onClick={exportFitData} disabled={!fits.length}>
            <Download size={16} />
            {t("exportFits")}
          </button>
          <button className="toolbar-button" onClick={() => void exportCurrentPlot()}>
            <BarChart3 size={16} />
            {t("exportPlot")}
          </button>
          <button
            className="toolbar-button"
            onClick={() => setLanguage((current) => (current === "zh" ? "en" : "zh"))}
          >
            <Languages size={16} />
            {language === "zh" ? "English" : "中文"}
          </button>
        </div>
      </header>

      {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

      <section className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="grid gap-4">
          <Panel title={t("files")}>
            {datasets.length === 0 ? (
              <div className="rounded-md border border-dashed border-line bg-panel p-3 text-sm text-slate-500">
                {t("noData")}
                <div className="mt-2 text-xs text-slate-400">
                  {sampleFiles.map((file) => (
                    <div key={file}>{file}</div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {orderedDatasets.map((dataset) => (
                  <DatasetCard
                    key={dataset.id}
                    dataset={dataset}
                    settings={settings}
                    t={t}
                    onUpdate={(patch) => updateDataset(dataset.id, patch)}
                    onMove={moveDataset}
                    onOverride={(patch) => updateOverride(dataset.id, patch)}
                  />
                ))}
              </div>
            )}
          </Panel>

          <Panel title={t("corrections")}>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("reference")} className="col-span-2">
                <select
                  className="number-input"
                  value={settings.referenceId}
                  onChange={(event) => updateSettings("referenceId", event.target.value as ReferencePresetId)}
                >
                  {referencePresets.map((reference) => (
                    <option key={reference.id} value={reference.id}>
                      {reference.label}
                    </option>
                  ))}
                </select>
              </Field>
              <NumberField label={t("customRef")} value={settings.customReferenceVsShe} onChange={(value) => updateSettings("customReferenceVsShe", value)} />
              <NumberField label={t("ocpOffset")} value={settings.ocpOffset} onChange={(value) => updateSettings("ocpOffset", value)} />
              <NumberField label={t("pH")} value={settings.pH} onChange={(value) => updateSettings("pH", value)} />
              <NumberField label={t("resistance")} value={settings.resistanceOhm} onChange={(value) => updateSettings("resistanceOhm", value)} />
              <NumberField label={t("irPercent")} value={settings.irPercent} onChange={(value) => updateSettings("irPercent", value)} />
              <Field label={t("normMode")}>
                <select
                  className="number-input"
                  value={settings.normalizeMode}
                  onChange={(event) => updateSettings("normalizeMode", event.target.value as NormalizeMode)}
                >
                  <option value="raw">{t("rawCurrent")}</option>
                  <option value="geo">{t("geo")}</option>
                  <option value="ecsa">{t("ecsa")}</option>
                  <option value="mass">{t("mass")}</option>
                </select>
              </Field>
              <NumberField label={t("geoArea")} value={settings.geometricAreaCm2} onChange={(value) => updateSettings("geometricAreaCm2", value)} />
              <NumberField label={t("ecsaArea")} value={settings.ecsaCm2} onChange={(value) => updateSettings("ecsaCm2", value)} />
              <NumberField label={t("loading")} value={settings.loadingMgCm2} onChange={(value) => updateSettings("loadingMgCm2", value)} />
            </div>
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
                    <button key={value} data-active={cycleMode === value} onClick={() => setCycleMode(value as CycleDisplayMode)}>
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
              <label className="flex items-center justify-between rounded-md border border-line bg-panel px-3 py-2 text-sm">
                <span>{t("stacked")}</span>
                <input type="checkbox" checked={stacked} onChange={(event) => setStacked(event.target.checked)} />
              </label>
              <NumberField label={t("stackStep")} value={stackStep} onChange={setStackStep} />
              <button className="toolbar-button w-full" onClick={() => setSettingsOpen(true)}>
                <Settings2 size={16} />
                {t("plotSettings")}
              </button>
              <button className="danger-button w-full" onClick={() => { setDatasets([]); setFits([]); setReadout(""); }}>
                <Trash2 size={16} />
                {t("clear")}
              </button>
            </div>
          </Panel>
        </aside>

        <section className="grid gap-4">
          <div className="panel p-2">
            <div className="segmented mb-2 grid max-w-md grid-cols-2">
              <button data-active={activePanel === "cv"} onClick={() => setActivePanel("cv")}>{t("cvPanel")}</button>
              <button data-active={activePanel === "tafel"} onClick={() => setActivePanel("tafel")}>{t("tafelPanel")}</button>
            </div>

            {activePanel === "cv" ? (
              <Plot
                data={cvTraces as any}
                layout={{
                  autosize: true,
                  height: 690,
                  paper_bgcolor: "#ffffff",
                  plot_bgcolor: "#fbfcfa",
                  margin: { l: 72, r: 28, t: 30, b: 64 },
                  xaxis: { title: { text: t("potentialAxis") }, zeroline: false, gridcolor: "#e6ebe6" },
                  yaxis: { title: { text: yLabel }, zeroline: true, gridcolor: "#e6ebe6" },
                  legend: { orientation: "h", y: 1.08, x: 0 },
                  hovermode: "closest",
                  font: { family: "Inter, Arial, sans-serif", color: "#172026" }
                }}
                config={{ responsive: true, displaylogo: false, modeBarButtonsToRemove: ["lasso2d"] }}
                style={{ width: "100%", height: "690px" }}
                onInitialized={(_, graphDiv) => { cvPlotRef.current = graphDiv as unknown as HTMLElement; }}
                onClick={(event) => setReadout(formatReadout(event, yLabel))}
              />
            ) : (
              <div className="grid gap-3 2xl:grid-cols-[minmax(0,1fr)_440px]">
                <div>
                  <div className="mb-3 grid gap-3 md:grid-cols-5">
                    <Field label={t("branch")}>
                      <select className="number-input" value={branchMode} onChange={(event) => setBranchMode(event.target.value as BranchMode)}>
                        <option value="forward">{t("forward")}</option>
                        <option value="reverse">{t("reverse")}</option>
                        <option value="all">{t("allBranch")}</option>
                      </select>
                    </Field>
                    <NumberField label={t("fitStart")} value={fitRange.start} onChange={(value) => setFitRange((range) => ({ ...range, start: value }))} />
                    <NumberField label={t("fitEnd")} value={fitRange.end} onChange={(value) => setFitRange((range) => ({ ...range, end: value }))} />
                    <div className="flex items-end">
                      <button className="primary-button w-full" onClick={runFits}>{t("fitAll")}</button>
                    </div>
                    <p className="flex items-end text-xs text-slate-500">{t("tafelNote")}</p>
                  </div>
                  <Plot
                    data={lsvTraces as any}
                    layout={{
                      autosize: true,
                      height: 380,
                      dragmode: "select",
                      paper_bgcolor: "#ffffff",
                      plot_bgcolor: "#fbfcfa",
                      margin: { l: 72, r: 28, t: 24, b: 58 },
                      xaxis: { title: { text: t("potentialAxis") }, gridcolor: "#e6ebe6" },
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
                      legend: { orientation: "h", y: 1.12 },
                      font: { family: "Inter, Arial, sans-serif", color: "#172026" }
                    }}
                    config={{ responsive: true, displaylogo: false }}
                    style={{ width: "100%", height: "380px" }}
                    onSelected={(event) => {
                      const xs =
                        (event as any)?.points
                          ?.map((point: { x: unknown }) => Number(point.x))
                          .filter(Number.isFinite) ?? [];
                      if (xs.length) setFitRange({ start: Math.min(...xs), end: Math.max(...xs) });
                    }}
                    onClick={(event) => setReadout(formatReadout(event, yLabel))}
                  />
                  <Plot
                    data={tafelTraces as any}
                    layout={{
                      autosize: true,
                      height: 360,
                      paper_bgcolor: "#ffffff",
                      plot_bgcolor: "#fbfcfa",
                      margin: { l: 72, r: 28, t: 24, b: 58 },
                      xaxis: { title: { text: t("logAxis") }, gridcolor: "#e6ebe6" },
                      yaxis: { title: { text: t("potentialAxis") }, gridcolor: "#e6ebe6" },
                      annotations: fits.map((fit, index) => ({
                        xref: "paper",
                        yref: "paper",
                        x: 0.02,
                        y: 0.96 - index * 0.09,
                        align: "left",
                        showarrow: false,
                        text: `${fit.displayName}: ${fit.slopeMvDec.toFixed(1)} mV/dec, R²=${fit.r2.toFixed(4)}, n=${fit.n}`,
                        font: { size: 12, color: "#172026" },
                        bgcolor: "rgba(255,255,255,0.82)",
                        bordercolor: "#dfe4df",
                        borderpad: 4
                      })),
                      legend: { orientation: "h", y: 1.12 },
                      font: { family: "Inter, Arial, sans-serif", color: "#172026" }
                    }}
                    config={{ responsive: true, displaylogo: false }}
                    style={{ width: "100%", height: "360px" }}
                  />
                </div>
                <FitTable fits={fits} t={t} />
              </div>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="panel p-3">
              <h2 className="mb-2 text-sm font-semibold">{t("clickReadout")}</h2>
              <p className="min-h-10 rounded-md bg-panel p-2 font-mono text-xs text-slate-600">
                {readout || "—"}
              </p>
            </div>
            <div className="panel p-3 text-sm text-slate-600">
              <h2 className="mb-2 font-semibold text-ink">Figma</h2>
              <p>{t("figmaHint")}</p>
            </div>
          </div>
        </section>
      </section>

      {settingsOpen ? (
        <div className="fixed inset-0 z-20 grid place-items-center bg-slate-950/35 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-4 shadow-soft">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">{t("plotSettings")}</h2>
              <button className="toolbar-button" onClick={() => setSettingsOpen(false)}>OK</button>
            </div>
            <p className="text-sm text-slate-600">
              {language === "zh"
                ? "当前版本提供科研配色、线宽、图例、缩放、框选和图片导出。后续维护可在这里扩展字体、坐标范围和期刊模板。"
                : "This version includes scientific colors, line widths, legend, zoom, selection, and image export. Future maintenance can add fonts, axis ranges, and journal templates here."}
            </p>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function DatasetCard({
  dataset,
  settings,
  t,
  onUpdate,
  onMove,
  onOverride
}: {
  dataset: Dataset;
  settings: CorrectionSettings;
  t: (key: string) => string;
  onUpdate: (patch: Partial<Dataset>) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onOverride: (patch: Partial<CorrectionSettings>) => void;
}) {
  const override = dataset.override;
  const activeSettings = { ...settings, ...override };
  return (
    <div className="rounded-lg border border-line bg-panel p-3">
      <div className="mb-2 flex items-start gap-2">
        <input
          className="mt-1 h-5 w-8 rounded border border-line"
          type="color"
          value={dataset.color}
          onChange={(event) => onUpdate({ color: event.target.value })}
          aria-label="Curve color"
        />
        <div className="min-w-0 flex-1">
          <label className="label">{t("rename")}</label>
          <input
            className="number-input"
            value={dataset.displayName}
            onChange={(event) => onUpdate({ displayName: event.target.value })}
          />
        </div>
        <button className="toolbar-button px-2" onClick={() => onUpdate({ visible: !dataset.visible })} title={dataset.visible ? t("hide") : t("show")}>
          {dataset.visible ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
      </div>
      <div className="mb-2 grid grid-cols-2 gap-2 text-xs text-slate-500">
        <div className="truncate">{t("originalName")}: {dataset.originalFileName}</div>
        <div>{t("parsedPoints")}: {dataset.points.length}</div>
        <div>{t("cycles")}: {cycleCount(dataset.points)}</div>
        <div>{dataset.sourceMeta?.parser ? String(dataset.sourceMeta.parser) : dataset.fileType}</div>
      </div>
      <div className="mb-2 flex gap-2">
        <button className="toolbar-button flex-1 px-2" onClick={() => onMove(dataset.id, -1)}><ArrowUp size={14} />{t("up")}</button>
        <button className="toolbar-button flex-1 px-2" onClick={() => onMove(dataset.id, 1)}><ArrowDown size={14} />{t("down")}</button>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-mint">{t("applyOverrides")}</summary>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <NumberField label={t("ocpOffset")} value={activeSettings.ocpOffset} onChange={(value) => onOverride({ ocpOffset: value })} />
          <NumberField label={t("resistance")} value={activeSettings.resistanceOhm} onChange={(value) => onOverride({ resistanceOhm: value })} />
          <NumberField label={t("geoArea")} value={activeSettings.geometricAreaCm2} onChange={(value) => onOverride({ geometricAreaCm2: value })} />
          <NumberField label={t("ecsaArea")} value={activeSettings.ecsaCm2} onChange={(value) => onOverride({ ecsaCm2: value })} />
          <button className="toolbar-button col-span-2" onClick={() => onUpdate({ override: undefined })}>
            <RotateCcw size={14} />
            {t("clear")}
          </button>
        </div>
      </details>
    </div>
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

function Field({
  label,
  children,
  className = ""
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={className}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        className="number-input"
        type="number"
        step="any"
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  );
}

function FitTable({ fits, t }: { fits: TafelFit[]; t: (key: string) => string }) {
  return (
    <aside className="rounded-lg border border-line bg-panel p-3">
      <h2 className="mb-3 text-sm font-semibold">{t("fitAll")}</h2>
      <div className="space-y-2">
        {fits.length === 0 ? (
          <p className="text-sm text-slate-500">—</p>
        ) : (
          fits.map((fit) => (
            <div key={fit.datasetId} className="rounded-md border border-line bg-white p-3 text-sm">
              <div className="mb-1 font-semibold">{fit.displayName}</div>
              <div>{t("slope")}: {fit.slopeMvDec.toFixed(2)} mV/dec</div>
              <div>{t("intercept")}: {fit.intercept.toFixed(4)} V</div>
              <div>{t("r2")}: {fit.r2.toFixed(5)}</div>
              <div>{t("nPoints")}: {fit.n}</div>
            </div>
          ))
        )}
      </div>
    </aside>
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

function formatReadout(event: any, yLabel: string) {
  const point = event.points?.[0];
  if (!point) return "";
  return `E=${Number(point.x).toFixed(5)} V, ${yLabel}=${Number(point.y).toExponential(4)}, trace=${point.data.name ?? ""}`;
}
