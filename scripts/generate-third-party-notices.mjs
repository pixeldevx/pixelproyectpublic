#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const rootDir = process.cwd();
const packageJsonPath = path.join(rootDir, 'package.json');
const lockPath = path.join(rootDir, 'package-lock.json');
const outputPath = path.join(rootDir, 'THIRD_PARTY_NOTICES.md');

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const rootPackage = readJson(packageJsonPath);
const lock = readJson(lockPath);

const runtimeDependencies = new Set(Object.keys(rootPackage.dependencies || {}));
const devDependencies = new Set(Object.keys(rootPackage.devDependencies || {}));

const normalizeLicense = (pkg) => {
  if (!pkg) return 'NOASSERTION';
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses)) {
    return pkg.licenses
      .map((license) => (typeof license === 'string' ? license : license?.type))
      .filter(Boolean)
      .join(' OR ') || 'NOASSERTION';
  }
  return 'NOASSERTION';
};

const normalizeRepository = (pkg) => {
  const repository = pkg?.repository;
  const rawUrl = typeof repository === 'string' ? repository : repository?.url;
  if (!rawUrl) return pkg?.homepage || '';
  const normalized = rawUrl.replace(/^git\+/, '').replace(/^git:/, 'https:').replace(/\.git$/, '');
  if (/^[\w.-]+\/[\w.-]+$/.test(normalized)) {
    return `https://github.com/${normalized}`;
  }
  return normalized;
};

const escapeCell = (value) => String(value || '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();

const inferPackageName = (lockKey) => {
  const parts = lockKey.replace(/^node_modules\//, '').split('/node_modules/');
  return parts[parts.length - 1];
};

const packagesByKey = new Map();

Object.entries(lock.packages || {}).forEach(([lockKey, lockEntry]) => {
  if (!lockKey.startsWith('node_modules/')) return;

  const packagePath = path.join(rootDir, lockKey, 'package.json');
  let packageData = {};
  if (fs.existsSync(packagePath)) {
    packageData = readJson(packagePath);
  }

  const name = packageData.name || lockEntry.name || inferPackageName(lockKey);
  const version = packageData.version || lockEntry.version || 'desconocida';
  const packageKey = `${name}@${version}`;
  const previous = packagesByKey.get(packageKey);
  const isRootPackage = lockKey === `node_modules/${name}`;
  const usage = isRootPackage && runtimeDependencies.has(name)
    ? 'Directa runtime'
    : isRootPackage && devDependencies.has(name)
      ? 'Directa desarrollo'
      : 'Transitiva';

  const record = {
    name,
    version,
    usage,
    license: normalizeLicense(packageData),
    repository: normalizeRepository(packageData),
  };

  if (!previous) {
    packagesByKey.set(packageKey, record);
    return;
  }

  if (previous.usage === 'Transitiva' && usage !== 'Transitiva') {
    packagesByKey.set(packageKey, record);
  }
});

const packages = [...packagesByKey.values()].sort((left, right) => {
  const leftRank = left.usage === 'Directa runtime' ? 0 : left.usage === 'Directa desarrollo' ? 1 : 2;
  const rightRank = right.usage === 'Directa runtime' ? 0 : right.usage === 'Directa desarrollo' ? 1 : 2;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return left.name.localeCompare(right.name);
});

const directPackages = packages.filter((pkg) => pkg.usage !== 'Transitiva');
const licenseSummary = packages.reduce((summary, pkg) => {
  summary[pkg.license] = (summary[pkg.license] || 0) + 1;
  return summary;
}, {});

const renderTable = (rows) => [
  '| Paquete | Version | Uso | Licencia | Proyecto |',
  '| --- | ---: | --- | --- | --- |',
  ...rows.map((pkg) => {
    const project = pkg.repository ? `[sitio](${pkg.repository})` : 'No declarado';
    return `| ${escapeCell(pkg.name)} | ${escapeCell(pkg.version)} | ${escapeCell(pkg.usage)} | ${escapeCell(pkg.license)} | ${project} |`;
  }),
].join('\n');

const content = `# Avisos de software de terceros

Pixel Project incluye software libre y de codigo abierto como dependencias de ejecucion, desarrollo y compilacion. Cada componente conserva su propia licencia, titulares y condiciones. Este archivo reconoce esos creditos y complementa la licencia MIT del proyecto.

Este inventario se genera desde \`package-lock.json\` y los \`package.json\` instalados en \`node_modules\`. Para actualizarlo despues de agregar o cambiar dependencias ejecuta:

\`\`\`bash
npm run notices
\`\`\`

## Resumen de licencias detectadas

${Object.entries(licenseSummary)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([license, count]) => `- ${license}: ${count}`)
  .join('\n')}

## Dependencias directas

${renderTable(directPackages)}

## Inventario completo de dependencias

${renderTable(packages)}

## Notas

- Los paquetes marcados como \`NOASSERTION\` no declaran licencia en su \`package.json\` instalado. Antes de redistribuir el codigo fuente completo se recomienda revisar manualmente el paquete y su repositorio.
- La licencia MIT de Pixel Project no modifica las obligaciones que puedan exigir las licencias de terceros incluidas en esta lista.
- Si un componente requiere conservar avisos de copyright adicionales, dichos avisos deben mantenerse junto con esta lista y con el paquete correspondiente.
`;

fs.writeFileSync(outputPath, content);
console.log(`Generated ${path.relative(rootDir, outputPath)} with ${packages.length} packages.`);
