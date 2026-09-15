import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [, , inputPath, outputPath] = process.argv;

if (!inputPath || !outputPath) {
  console.error(
    "Uso: node scripts/generate-colombia-location-catalog.mjs <archivo.dbf> <salida.json>"
  );
  process.exit(1);
}

const decodeField = (buffer) => new TextDecoder("utf-8").decode(buffer).replace(/\0/g, "").trim();

const parseDbf = (buffer) => {
  const recordCount = buffer.readUInt32LE(4);
  const headerLength = buffer.readUInt16LE(8);
  const recordLength = buffer.readUInt16LE(10);
  const fields = [];

  for (let offset = 32; offset < headerLength - 1; offset += 32) {
    if (buffer[offset] === 0x0d) break;
    const name = decodeField(buffer.subarray(offset, offset + 11));
    const type = String.fromCharCode(buffer[offset + 11]);
    const length = buffer[offset + 16];
    fields.push({ name, type, length });
  }

  const records = [];
  for (let index = 0; index < recordCount; index += 1) {
    const recordOffset = headerLength + index * recordLength;
    if (recordOffset + recordLength > buffer.length || buffer[recordOffset] === 0x2a) continue;

    const record = {};
    let fieldOffset = recordOffset + 1;
    fields.forEach((field) => {
      record[field.name] = decodeField(buffer.subarray(fieldOffset, fieldOffset + field.length));
      fieldOffset += field.length;
    });
    records.push(record);
  }

  return records;
};

const collator = new Intl.Collator("es-CO", { sensitivity: "base", numeric: true });
const CANONICAL_DEPARTMENT_NAMES = new Map([
  ["11", "Bogotá, D.C."],
]);
const dbf = await readFile(inputPath);
const records = parseDbf(dbf)
  .map((record) => {
    const departmentCode = String(record.MpCodigo || "").slice(0, 2);
    return {
      departmentCode,
      department: CANONICAL_DEPARTMENT_NAMES.get(departmentCode) || String(record.Depto || "").trim(),
      municipalityCode: String(record.MpCodigo || "").padStart(5, "0"),
      municipality: String(record.MpNombre || "").trim(),
    };
  })
  .filter(
    (record) =>
      record.municipalityCode !== "00000" &&
      record.department &&
      record.department.toUpperCase() !== "N/A" &&
      record.municipality &&
      record.municipality.toUpperCase() !== "N/A"
  );

const departmentsByCode = new Map();
records.forEach((record) => {
  const current = departmentsByCode.get(record.departmentCode) || {
    code: record.departmentCode,
    name: record.department,
    municipalities: [],
  };
  current.municipalities.push({ code: record.municipalityCode, name: record.municipality });
  departmentsByCode.set(record.departmentCode, current);
});

const departments = Array.from(departmentsByCode.values())
  .map((department) => ({
    ...department,
    municipalities: department.municipalities.sort((left, right) => collator.compare(left.name, right.name)),
  }))
  .sort((left, right) => collator.compare(left.name, right.name));

const catalog = {
  source: {
    file: `${path.basename(inputPath, path.extname(inputPath))}.shp`,
    attributeTable: path.basename(inputPath),
    layer: "Munpio",
    fields: {
      department: "Depto",
      municipality: "MpNombre",
      municipalityCode: "MpCodigo",
    },
    country: "Colombia",
  },
  departments,
};

await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
console.log(
  `Catálogo generado: ${departments.length} departamentos, ${records.length} municipios (${outputPath})`
);
