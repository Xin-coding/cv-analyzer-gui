import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { cycleCount } from "../src/lib/parser";
import { parseMprBuffer, parseTextBuffer } from "../src/lib/parser";

const fixtures = [
  "C:\\Users\\Xin\\Desktop\\(0_5M sodium carbonate  pH=11 with 0_1M Glucose)-S1-FTO-100nm 80Au20Pd GREY-0_225cm2_C01.mpr",
  "C:\\Users\\Xin\\Desktop\\(0_5M sodium carbonate  pH=11 with 0_1M Glucose)-S1-NaOH modified Ti foil-100nm 80Au20Pd-Black polish covered-0_14cm2_C01.mpr",
  "C:\\Users\\Xin\\Desktop\\CV 10mV 1M KOH 100mM EG Ni30S5.txt",
  "C:\\Users\\Xin\\Desktop\\CV 10mV 1M KOH 100mM EG Ni30S6.txt"
];

for (const filePath of fixtures) {
  const buffer = await readFile(filePath);
  const extension = extname(filePath).slice(1).toLowerCase();
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
  const parsed =
    extension === "mpr"
      ? await parseMprBuffer(arrayBuffer)
      : parseTextBuffer(arrayBuffer, basename(filePath), extension);
  const first = parsed.points[0];
  const last = parsed.points.at(-1);
  console.log(
    JSON.stringify({
      file: basename(filePath),
      points: parsed.points.length,
      cycles: cycleCount(parsed.points),
      first,
      last,
      meta: parsed.meta
    })
  );
  if (parsed.points.length < 10) {
    throw new Error(`Too few points parsed from ${filePath}`);
  }
}
