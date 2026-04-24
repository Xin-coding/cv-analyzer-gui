import type { Dataset, RawPoint } from "./types";
import { palette } from "./constants";

type VariableHit = {
  key: string;
  label: string;
  unit: string;
  values: number[];
};

export async function parseFiles(files: File[], existingCount = 0): Promise<Dataset[]> {
  const datasets: Dataset[] = [];
  for (const [fileIndex, file] of files.entries()) {
    const dataset = await parseFile(file, existingCount + fileIndex);
    datasets.push(dataset);
  }
  return datasets;
}

export async function parseFile(file: File, order: number): Promise<Dataset> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const buffer = await file.arrayBuffer();
  const parsed =
    extension === "mpr"
      ? await parseMprBuffer(buffer)
      : parseTextBuffer(buffer, file.name, extension);

  return {
    id: crypto.randomUUID(),
    originalFileName: file.name,
    displayName: trimExtension(file.name),
    fileType: extension,
    points: parsed.points,
    visible: true,
    color: palette[order % palette.length],
    order,
    stackOffset: 0,
    sourceMeta: parsed.meta
  };
}

export async function parseMprBuffer(buffer: ArrayBuffer): Promise<{
  points: RawPoint[];
  meta: Record<string, unknown>;
}> {
  let result: unknown;
  try {
    const { parseMPR } = await import("biologic-converter");
    result = parseMPR(buffer);
  } catch (error) {
    result = parseMprDataOnly(buffer, error);
  }
  const variables = extractVariables(result);
  const potential = pickVariable(variables, [
    /(^|[^a-z])ewe([^a-z]|$)/i,
    /potential/i,
    /voltage/i,
    /ewe.*v/i
  ]);
  const current = pickVariable(variables, [/current/i, /(^|[^a-z])i([^a-z]|$)/i]);
  const cycle = pickVariable(variables, [/cycle/i, /scan/i]);
  const time = pickVariable(variables, [/time/i]);

  if (!potential || !current) {
    const names = variables.map((item) => `${item.key}:${item.label}`).slice(0, 25).join(", ");
    throw new Error(`MPR columns not found. Available variables: ${names}`);
  }

  const n = Math.min(potential.values.length, current.values.length);
  const inferredCycles = cycle?.values?.length ? cycle.values : inferCycles(potential.values);
  const points: RawPoint[] = [];
  for (let index = 0; index < n; index += 1) {
    const e = potential.values[index] * potentialFactor(potential);
    const i = current.values[index] * currentFactor(current);
    if (Number.isFinite(e) && Number.isFinite(i)) {
      points.push({
        potential: e,
        current: i,
        cycle: Math.max(1, Math.round(inferredCycles[index] ?? 1)),
        index,
        time: time?.values[index]
      });
    }
  }
  return {
    points,
    meta: {
      parser: "biologic-converter",
      mprName: (result as { name?: string })?.name,
      fallback: (result as { fallback?: boolean })?.fallback ?? false,
      potentialColumn: potential.label || potential.key,
      currentColumn: current.label || current.key
    }
  };
}

export function parseTextBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  extension: string
): { points: RawPoint[]; meta: Record<string, unknown> } {
  const text = decodeText(buffer);
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headerIndex = findHeaderIndex(lines);
  if (headerIndex < 0) throw new Error("No tabular header found.");

  const delimiter = sniffDelimiter(lines[headerIndex]);
  const headers = splitLine(lines[headerIndex], delimiter).map((header) => header.trim());
  const potentialIndex = pickHeader(headers, [
    /WE.*Potential/i,
    /Ewe/i,
    /Potential.*\(V\)/i,
    /Potential applied/i,
    /^E\s*\/?\s*V$/i,
    /Voltage/i
  ]);
  const currentIndex = pickHeader(headers, [
    /WE.*Current/i,
    /Current.*\(A\)/i,
    /^I\s*\/?\s*(A|mA|uA|µA)?$/i,
    /<I>/i
  ]);
  const cycleIndex = pickHeader(headers, [/^Scan$/i, /cycle/i, /^Ns$/i]);
  const timeIndex = pickHeader(headers, [/time/i]);

  if (potentialIndex < 0 || currentIndex < 0) {
    throw new Error(`Potential/current columns not found in ${fileName}.`);
  }

  const potentialHeader = headers[potentialIndex];
  const currentHeader = headers[currentIndex];
  const rawRows = lines.slice(headerIndex + 1).map((line) => splitLine(line, delimiter));
  const potentials = rawRows.map((row) => toNumber(row[potentialIndex]) * headerPotentialFactor(potentialHeader));
  const inferredCycles =
    cycleIndex >= 0
      ? rawRows.map((row) => Math.max(1, Math.round(toNumber(row[cycleIndex]) || 1)))
      : inferCycles(potentials);
  const points: RawPoint[] = [];

  rawRows.forEach((row, index) => {
    const potential = potentials[index];
    const current = toNumber(row[currentIndex]) * headerCurrentFactor(currentHeader);
    if (Number.isFinite(potential) && Number.isFinite(current)) {
      points.push({
        potential,
        current,
        cycle: inferredCycles[index] ?? 1,
        index,
        time: timeIndex >= 0 ? toNumber(row[timeIndex]) : undefined
      });
    }
  });

  return {
    points,
    meta: {
      parser: "text",
      extension,
      delimiter,
      potentialColumn: potentialHeader,
      currentColumn: currentHeader
    }
  };
}

export function cycleCount(points: RawPoint[]) {
  return new Set(points.map((point) => point.cycle)).size;
}

function extractVariables(result: unknown): VariableHit[] {
  const variables = (result as { data?: { variables?: Record<string, unknown> } })?.data?.variables ?? {};
  const hits: VariableHit[] = [];
  for (const [key, raw] of Object.entries(variables)) {
    const values = numericArray(raw);
    if (values.length === 0) continue;
    const objectRaw = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const label = String(objectRaw.name ?? objectRaw.label ?? objectRaw.shortName ?? key);
    const unit = String(objectRaw.unit ?? objectRaw.units ?? "");
    hits.push({ key, label, unit, values });
  }
  return hits;
}

function parseMprDataOnly(buffer: ArrayBuffer, originalError: unknown) {
  const view = new DataView(buffer);
  let offset = 0x34;
  const parsed: Record<string, { label: string; units: string; data: Float64Array }> = {};
  while (offset + 6 < view.byteLength && ascii(view, offset, 6) === "MODULE") {
    offset += 6;
    const shortName = ascii(view, offset, 10).trim();
    offset += 10;
    const longName = ascii(view, offset, 25).trim();
    offset += 25;
    const maxOrLength = view.getUint32(offset, true);
    offset += 4;
    const length =
      maxOrLength === 0xffffffff
        ? view.getUint32(offset, true)
        : maxOrLength;
    if (maxOrLength === 0xffffffff) offset += 4;
    const version = view.getUint32(offset, true);
    offset += 4;
    if (maxOrLength === 0xffffffff) offset += 4;
    const date = ascii(view, offset, 8);
    offset += 8;
    const dataStart = offset;
    if (/data/i.test(longName)) {
      Object.assign(parsed, parseMprDataModule(view, dataStart, version));
      return {
        name: ascii(view, 0, 0x34).replace(/[\u001A\u0000]/g, "").trim(),
        fallback: true,
        originalError: originalError instanceof Error ? originalError.message : String(originalError),
        data: {
          header: { shortName, longName, length, version, date },
          variables: oneLetterVariables(parsed)
        }
      };
    }
    offset = dataStart + length;
  }
  throw new Error(
    `MPR fallback could not locate a data module after parser error: ${
      originalError instanceof Error ? originalError.message : String(originalError)
    }`
  );
}

function parseMprDataModule(view: DataView, start: number, version: number) {
  const dataPoints = view.getUint32(start, true);
  const columns = view.getUint8(start + 4);
  const ids: number[] = [];
  const variables: Record<string, { label: string; units: string; data: Float64Array }> = {};

  let dataOffset: number;
  if (version === 0) {
    if (view.getUint8(start + 5) !== 0) {
      for (let index = 0; index < columns; index += 1) ids.push(view.getUint8(start + 5 + index));
      dataOffset = start + 100;
    } else {
      for (let index = 0; index < columns; index += 1) ids.push(view.getUint8(start + 5 + index * 2 + 1));
      dataOffset = start + 1007;
    }
  } else if (version === 2 || version === 3) {
    for (let index = 0; index < columns; index += 1) {
      ids.push(view.getUint16(start + 5 + index * 2, true));
    }
    dataOffset = start + (version === 3 ? 406 : 405);
  } else {
    throw new Error(`Unsupported MPR data module version ${version}.`);
  }

  for (let index = 0; index < columns; index += 1) {
    const id = ids[index];
    const dataColumn = fallbackDataColumns[id];
    const flagColumn = fallbackFlagColumns[id];
    if (dataColumn) {
      variables[dataColumn.name] = {
        label: dataColumn.name,
        units: dataColumn.unit,
        data: new Float64Array(dataPoints)
      };
    } else if (flagColumn) {
      variables[flagColumn.name] = {
        label: flagColumn.name,
        units: "flag",
        data: new Float64Array(dataPoints)
      };
    }
  }

  let offset = dataOffset;
  for (let pointIndex = 0; pointIndex < dataPoints; pointIndex += 1) {
    let flagByte: number | null = null;
    for (const id of ids) {
      const flagColumn = fallbackFlagColumns[id];
      const dataColumn = fallbackDataColumns[id];
      if (flagColumn) {
        if (flagByte === null) {
          flagByte = view.getUint8(offset);
          offset += 1;
        }
        const shift = Math.log2(flagColumn.bitMask & -flagColumn.bitMask);
        variables[flagColumn.name].data[pointIndex] = (flagColumn.bitMask & flagByte) >> shift;
      } else if (dataColumn) {
        const [value, nextOffset] = readMprTyped(view, offset, dataColumn.dType);
        variables[dataColumn.name].data[pointIndex] = value;
        offset = nextOffset;
      } else {
        throw new Error(`Unknown MPR data column id 0x${id.toString(16)}.`);
      }
    }
  }
  return variables;
}

function oneLetterVariables(
  variables: Record<string, { label: string; units: string; data: Float64Array }>
) {
  const entries = Object.values(variables);
  return Object.fromEntries(entries.map((variable, index) => [String.fromCharCode(97 + index), variable]));
}

function readMprTyped(view: DataView, offset: number, type: string): [number, number] {
  switch (type) {
    case "Uint8":
    case "u1":
      return [view.getUint8(offset), offset + 1];
    case "Uint16":
    case "u2":
      return [view.getUint16(offset, true), offset + 2];
    case "Uint32":
    case "u4":
      return [view.getUint32(offset, true), offset + 4];
    case "Float32":
    case "f4":
      return [view.getFloat32(offset, true), offset + 4];
    case "Float64":
    case "f8":
      return [view.getFloat64(offset, true), offset + 8];
    default:
      throw new Error(`Unknown MPR dtype ${type}.`);
  }
}

function ascii(view: DataView, offset: number, length: number) {
  let result = "";
  for (let index = 0; index < length && offset + index < view.byteLength; index += 1) {
    result += String.fromCharCode(view.getUint8(offset + index));
  }
  return result;
}

function numericArray(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw.map(toNumber).filter(Number.isFinite);
  if (raw && typeof raw === "object") {
    const objectRaw = raw as Record<string, unknown>;
    for (const key of ["data", "values", "value", "array"]) {
      const value = objectRaw[key];
      if (Array.isArray(value)) return value.map(toNumber).filter(Number.isFinite);
      if (value && typeof value === "object" && Symbol.iterator in Object(value)) {
        return Array.from(value as Iterable<unknown>).map(toNumber).filter(Number.isFinite);
      }
    }
  }
  return [];
}

function pickVariable(variables: VariableHit[], patterns: RegExp[]) {
  return variables
    .map((variable) => ({
      variable,
      score: patterns.reduce((score, pattern, index) => {
        const haystack = `${variable.key} ${variable.label} ${variable.unit}`;
        return score + (pattern.test(haystack) ? 10 - index : 0);
      }, 0)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.variable;
}

function findHeaderIndex(lines: string[]) {
  return lines.findIndex((line) => {
    const delimiter = sniffDelimiter(line);
    const parts = splitLine(line, delimiter);
    return (
      parts.length >= 2 &&
      /potential|current|ewe|<i>|we\(1\)/i.test(line)
    );
  });
}

function sniffDelimiter(line: string) {
  const delimiters = [";", "\t", ","];
  return delimiters
    .map((delimiter) => ({ delimiter, count: splitLine(line, delimiter).length }))
    .sort((a, b) => b.count - a.count)[0].delimiter;
}

function splitLine(line: string, delimiter: string) {
  if (delimiter !== ",") return line.split(delimiter);
  const result: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      result.push(current);
      current = "";
    } else current += char;
  }
  result.push(current);
  return result;
}

function pickHeader(headers: string[], patterns: RegExp[]) {
  let best = -1;
  let bestScore = 0;
  headers.forEach((header, index) => {
    const score = patterns.reduce((sum, pattern, patternIndex) => {
      return sum + (pattern.test(header) ? 10 - patternIndex : 0);
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
}

function inferCycles(potentials: number[]) {
  const cycles = new Array(potentials.length).fill(1);
  let cycle = 1;
  let flips = 0;
  let lastSign = 0;
  for (let index = 1; index < potentials.length; index += 1) {
    const delta = potentials[index] - potentials[index - 1];
    const sign = Math.abs(delta) < 1e-10 ? lastSign : Math.sign(delta);
    if (lastSign !== 0 && sign !== 0 && sign !== lastSign) {
      flips += 1;
      if (flips % 2 === 0) cycle += 1;
    }
    cycles[index] = cycle;
    if (sign !== 0) lastSign = sign;
  }
  return cycles;
}

function decodeText(buffer: ArrayBuffer) {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (utf8.includes("\uFFFD")) return new TextDecoder("windows-1252", { fatal: false }).decode(buffer);
  return utf8;
}

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (value === undefined || value === null) return Number.NaN;
  const cleaned = String(value).trim().replace(",", ".");
  if (!cleaned) return Number.NaN;
  return Number(cleaned);
}

function headerPotentialFactor(header: string) {
  return /\bmv\b|mV/i.test(header) ? 1e-3 : 1;
}

function headerCurrentFactor(header: string) {
  if (/µA|uA/i.test(header)) return 1e-6;
  if (/mA/i.test(header)) return 1e-3;
  if (/nA/i.test(header)) return 1e-9;
  return 1;
}

function potentialFactor(variable: VariableHit) {
  return /\bmv\b|mV/i.test(`${variable.label} ${variable.unit}`) ? 1e-3 : 1;
}

function currentFactor(variable: VariableHit) {
  const label = `${variable.label} ${variable.unit}`;
  if (/µA|uA/i.test(label)) return 1e-6;
  if (/mA/i.test(label)) return 1e-3;
  if (/nA/i.test(label)) return 1e-9;
  return 1;
}

function trimExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

const fallbackFlagColumns: Record<number, { bitMask: number; name: string }> = {
  1: { bitMask: 0x03, name: "mode" },
  2: { bitMask: 0x04, name: "ox/red" },
  3: { bitMask: 0x08, name: "error" },
  21: { bitMask: 0x10, name: "control changes" },
  31: { bitMask: 0x20, name: "Ns changes" },
  65: { bitMask: 0x80, name: "counter inc." }
};

const fallbackDataColumns: Record<number, { dType: string; name: string; unit: string }> = {
  4: { dType: "f8", name: "time", unit: "s" },
  5: { dType: "f4", name: "control_V/I", unit: "V/mA" },
  6: { dType: "f4", name: "Ewe", unit: "V" },
  7: { dType: "f8", name: "dq", unit: "mA.h" },
  8: { dType: "f4", name: "I", unit: "mA" },
  9: { dType: "f4", name: "Ece", unit: "V" },
  11: { dType: "f8", name: "<I>", unit: "mA" },
  13: { dType: "f8", name: "(Q-Qo)", unit: "mA.h" },
  16: { dType: "f4", name: "Analog IN 1", unit: "V" },
  17: { dType: "f4", name: "Analog IN 2", unit: "V" },
  19: { dType: "f4", name: "control_V", unit: "V" },
  20: { dType: "f4", name: "control_I", unit: "mA" },
  23: { dType: "f8", name: "dQ", unit: "mA.h" },
  24: { dType: "f8", name: "cycle number", unit: "" },
  26: { dType: "f4", name: "Rapp", unit: "Ohm" },
  27: { dType: "f4", name: "Ewe-Ece", unit: "V" },
  32: { dType: "f4", name: "freq", unit: "Hz" },
  33: { dType: "f4", name: "|Ewe|", unit: "V" },
  34: { dType: "f4", name: "|I|", unit: "A" },
  35: { dType: "f4", name: "Phase(Z)", unit: "deg" },
  36: { dType: "f4", name: "|Z|", unit: "Ohm" },
  37: { dType: "f4", name: "Re(Z)", unit: "Ohm" },
  38: { dType: "f4", name: "-Im(Z)", unit: "Ohm" },
  39: { dType: "u2", name: "I Range", unit: "" },
  69: { dType: "f4", name: "R", unit: "Ohm" },
  70: { dType: "f4", name: "P", unit: "W" },
  74: { dType: "f8", name: "|Energy|", unit: "W.h" },
  75: { dType: "f4", name: "Analog OUT", unit: "V" },
  76: { dType: "f4", name: "<I>", unit: "mA" },
  77: { dType: "f4", name: "<Ewe>", unit: "V" },
  96: { dType: "f4", name: "|Ece|", unit: "V" },
  123: { dType: "f8", name: "Energy charge", unit: "W.h" },
  124: { dType: "f8", name: "Energy discharge", unit: "W.h" },
  125: { dType: "f8", name: "Capacitance charge", unit: "uF" },
  126: { dType: "f8", name: "Capacitance discharge", unit: "uF" },
  131: { dType: "u2", name: "Ns", unit: "" },
  168: { dType: "f4", name: "Rcmp", unit: "Ohm" },
  169: { dType: "f4", name: "Cs", unit: "uF" },
  172: { dType: "f4", name: "Cp", unit: "uF" },
  173: { dType: "f4", name: "Cp-2", unit: "uF-2" },
  174: { dType: "f4", name: "<Ewe>", unit: "V" },
  178: { dType: "f4", name: "(Q-Qo)", unit: "C" },
  179: { dType: "f4", name: "dQ", unit: "C" },
  211: { dType: "f8", name: "Q charge/discharge", unit: "mA.h" },
  212: { dType: "u4", name: "half cycle", unit: "" },
  213: { dType: "u4", name: "z cycle", unit: "" },
  438: { dType: "f8", name: "step time", unit: "s" },
  441: { dType: "f4", name: "<Ecv>", unit: "V" },
  462: { dType: "f4", name: "Temperature", unit: "C" },
  467: { dType: "f8", name: "Q charge/discharge", unit: "mA.h" },
  468: { dType: "u4", name: "half cycle", unit: "" },
  469: { dType: "u4", name: "z cycle", unit: "" },
  471: { dType: "f4", name: "<Ece>", unit: "V" },
  498: { dType: "f8", name: "Q charge", unit: "mA.h" },
  499: { dType: "f8", name: "Q discharge", unit: "mA.h" },
  500: { dType: "f8", name: "step time", unit: "s" },
  501: { dType: "f8", name: "Efficiency", unit: "%" },
  502: { dType: "f8", name: "Capacity", unit: "mA.h" },
  505: { dType: "f4", name: "Rdc", unit: "Ohm" },
  509: { dType: "u1", name: "Acir/Dcir Control", unit: "" }
};
