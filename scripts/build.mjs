// SPDX-License-Identifier: MIT
// Сборка иконок: SVG → PNG для всех масштабов 1С, manifest.xml, zip-архив картинки и превью.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const distDir = path.join(root, 'dist');

// Варианты картинки 1С: плотность экрана, суффикс файла (масштаб, %), размер в пикселях, сетка исходника
const VARIANTS = [
  { density: 'bldpi', scale: 85, size: 14, grid: 16 },
  { density: 'ldpi', scale: 100, size: 16, grid: 16 },
  { density: 'aldpi', scale: 125, size: 20, grid: 16 },
  { density: 'mdpi', scale: 150, size: 24, grid: 32 },
  { density: 'amdpi', scale: 175, size: 28, grid: 32 },
  { density: 'hdpi', scale: 200, size: 32, grid: 32 },
  { density: 'xdpi', scale: 300, size: 48, grid: 32 },
  { density: 'udpi', scale: 400, size: 64, grid: 32 },
];

const PREVIEW_SIZES = [16, 20, 24, 32, 48, 64];

// Фиксированная дата в архиве, чтобы сборка была воспроизводимой (01.01.2026 00:00)
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

async function main() {
  const icons = JSON.parse(await readFile(path.join(root, 'icons.json'), 'utf8'));
  await rm(distDir, { recursive: true, force: true });

  const built = [];
  const missing = [];
  for (const icon of icons) {
    const sources = await readSources(icon.name);
    if (!sources) {
      missing.push(icon);
      continue;
    }
    const files = [];
    for (const variant of VARIANTS) {
      const svg = sources[variant.grid] ?? sources[16] ?? sources[32];
      const png = render(svg, variant.size);
      await writeOut(path.join('png', String(variant.size), `${icon.name}.png`), png);
      files.push({ name: `${icon.name}_${variant.scale}.png`, data: png });
    }
    files.unshift({ name: 'manifest.xml', data: Buffer.from(manifest(icon.name), 'utf8') });
    for (const file of files) {
      await writeOut(path.join('1c', icon.name, file.name), file.data);
    }
    await writeOut(path.join('1c', `${icon.name}.zip`), zipStored(files));
    built.push(icon);
  }

  await writeOut('preview.html', Buffer.from(previewHtml(built, missing), 'utf8'));
  console.log(`Собрано иконок: ${built.length}, не нарисовано: ${missing.length}`);
}

async function readSources(name) {
  const result = {};
  for (const grid of [16, 32]) {
    const file = path.join(srcDir, String(grid), `${name}.svg`);
    if (existsSync(file)) {
      result[grid] = await readFile(file, 'utf8');
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function render(svg, size) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  return resvg.render().asPng();
}

async function writeOut(relativePath, data) {
  const file = path.join(distDir, relativePath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
}

function manifest(name) {
  const lines = VARIANTS.map(
    (variant) =>
      `\t<PictureVariant name="${name}_${variant.scale}.png" screenDensity="${variant.density}" glyphWidth="${variant.size}" glyphHeight="${variant.size}"/>`,
  );
  return ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '<Picture>', ...lines, '</Picture>', ''].join('\n');
}

// Zip-архив без сжатия (метод stored)
function zipStored(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const fileName = Buffer.from(name, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(10, 6);
    entry.writeUInt16LE(DOS_TIME, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(fileName.length, 28);
    entry.writeUInt32LE(offset, 42);

    parts.push(local, fileName, data);
    central.push(entry, fileName);
    offset += local.length + fileName.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

function previewHtml(built, missing) {
  const header = PREVIEW_SIZES.map((size) => `<th>${size}</th>`).join('');
  const rows = built
    .map((icon) => {
      const cells = PREVIEW_SIZES.map((size) => `<td><img src="png/${size}/${icon.name}.png" alt=""></td>`).join('');
      const tree = `<span class="tree"><img src="png/16/${icon.name}.png" alt="">${icon.title}</span>`;
      return `<tr><td><code>${icon.name}</code><br>${icon.title}</td>
<td class="zoom"><img src="png/16/${icon.name}.png" alt=""></td>${cells}
<td>${tree}</td><td class="dark">${tree}</td></tr>`;
    })
    .join('\n');
  const todo = missing.map((icon) => `<li><code>${icon.name}</code> — ${icon.title}</li>`).join('');
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>Иконки метаданных 1С</title>
<style>
body{font:14px/1.4 "Segoe UI",Arial,sans-serif;margin:24px;color:#1f2328;background:#fff}
table{border-collapse:collapse}th,td{border:1px solid #d0d7de;padding:6px 10px;text-align:center;vertical-align:middle}
td:first-child{text-align:left}th{background:#f6f8fa;font-weight:600}
.zoom img{width:64px;height:64px;image-rendering:pixelated}
.tree{display:inline-flex;align-items:center;gap:4px;font-size:13px;white-space:nowrap}
.dark{background:#252526;color:#e6e6e6}
</style></head><body>
<h1>Иконки метаданных 1С</h1>
<p>Нарисовано: ${built.length}. Не нарисовано: ${missing.length}.</p>
<table><tr><th>Иконка</th><th>16 ×4</th>${header}<th>В дереве</th><th>На тёмном</th></tr>
${rows}
</table>
${missing.length ? `<h2>Не нарисованы</h2><ul>${todo}</ul>` : ''}
<p>© 2026 Журавлев Анатолий, CC BY 4.0</p>
</body></html>
`;
}

await main();
