// SPDX-License-Identifier: MIT
// Сборка иконок: SVG → PNG для всех масштабов 1С, manifest.xml, zip-архив картинки и превью.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { SOURCE_GRIDS, VARIANTS, selectSourceGrid } from './variants.mjs';
import { zipStored } from './zip.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const distDir = path.join(root, 'dist');
const docsDir = path.join(root, 'docs');

const PREVIEW_SIZES = [16, 20, 24, 32, 48, 64];

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
      const svg = sources[selectSourceGrid(Object.keys(sources).map(Number), variant.grid)];
      const png = render(svg, variant.size);
      await writeOut(path.join('png', String(variant.size), `${icon.name}.png`), png);
      files.push({ name: `${icon.name}_${variant.scale}.png`, data: png });
    }
    files.unshift({ name: 'manifest.xml', data: Buffer.from(manifest(icon.name), 'utf8') });
    for (const file of files) {
      await writeOut(path.join('1c', icon.name, file.name), file.data);
    }
    await writeOut(path.join('1c', `${icon.name}.zip`), zipStored(files));
    built.push({ ...icon, sources });
  }

  await writeOut('preview.html', Buffer.from(previewHtml(built, missing), 'utf8'));
  // Превью для GitHub лежит вне dist и коммитится: GitHub показывает SVG, но не HTML
  await mkdir(docsDir, { recursive: true });
  await writeFile(path.join(docsDir, 'preview.svg'), previewSvg(built));
  console.log(`Собрано иконок: ${built.length}, не нарисовано: ${missing.length}`);
}

async function readSources(name) {
  const result = {};
  for (const grid of SOURCE_GRIDS) {
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

function previewHtml(built, missing) {
  const header = PREVIEW_SIZES.map((size) => `<th>${size}</th>`).join('');
  const rows = built
    .map((icon) => {
      const cells = PREVIEW_SIZES.map((size) => `<td><img class="pixel" src="png/${size}/${icon.name}.png" width="${size}" height="${size}" style="--pixels:${size}" alt=""></td>`).join('');
      const tree = `<span class="tree"><img class="pixel" data-tree-icon="${icon.name}" src="png/16/${icon.name}.png" width="16" height="16" style="--pixels:16" alt="">${icon.title}</span>`;
      return `<tr><td><code>${icon.name}</code><br>${icon.title}</td>
<td class="zoom"><img class="pixel" src="png/16/${icon.name}.png" width="64" height="64" style="--pixels:64" alt=""></td>${cells}
<td>${tree}</td><td class="dark">${tree}</td></tr>`;
    })
    .join('\n');
  const todo = missing.map((icon) => `<li><code>${icon.name}</code> — ${icon.title}</li>`).join('');
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Иконки метаданных 1С</title>
<style>
body{font:14px/1.4 "Segoe UI",Arial,sans-serif;margin:24px;color:#1f2328;background:#fff}
table{border-collapse:collapse}th,td{border:1px solid #d0d7de;padding:6px 10px;text-align:center;vertical-align:middle}
td:first-child{text-align:left}th{background:#f6f8fa;font-weight:600}
.pixel{width:calc(var(--pixels)*1px / var(--dpr,1));height:calc(var(--pixels)*1px / var(--dpr,1))}
.zoom img{image-rendering:pixelated}
.tree{display:inline-flex;align-items:center;gap:4px;font-size:13px;white-space:nowrap}
.dark{background:#252526;color:#e6e6e6}
</style></head><body>
<h1>Иконки метаданных 1С</h1>
<p>Нарисовано: ${built.length}. Не нарисовано: ${missing.length}.</p>
<p>Размеры указаны в точках экрана: PNG показаны пиксель в пиксель, увеличение 16 ×4 занимает 64 точки. В дереве выбран ближайший к плотности экрана вариант. Для 20 и 24 px есть отдельные исходники.</p>
<noscript><p>Без JavaScript таблица доступна, но плотность экрана не компенсируется: браузер может растягивать PNG.</p></noscript>
<table><tr><th>Иконка</th><th>16 ×4</th>${header}<th>В дереве</th><th>На тёмном</th></tr>
${rows}
</table>
${missing.length ? `<h2>Не нарисованы</h2><ul>${todo}</ul>` : ''}
<p>© 2026 Журавлев Анатолий, CC BY 4.0</p>
<script>
const variants = ${JSON.stringify(VARIANTS.map(({ scale, size }) => ({ scale, size })))};
let alignmentFrame = null;
function alignPngOrigins() {
  if (alignmentFrame !== null) return;
  alignmentFrame = requestAnimationFrame(() => {
    alignmentFrame = null;
    const images = [...document.querySelectorAll('img[src^="png/"]')];
    for (const img of images) img.style.translate = '';
    const density = window.devicePixelRatio || 1;
    const offsets = images.map((img) => {
      if (!img.getClientRects().length) return null;
      const rect = img.getBoundingClientRect();
      const style = getComputedStyle(img);
      const left = rect.left + (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.paddingLeft) || 0);
      const top = rect.top + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.paddingTop) || 0);
      return {
        img,
        x: (Math.round(left * density) - left * density) / density,
        y: (Math.round(top * density) - top * density) / density,
      };
    });
    for (const offset of offsets) {
      if (offset) offset.img.style.translate = offset.x + 'px ' + offset.y + 'px';
    }
  });
}
window.addEventListener('resize', alignPngOrigins);
document.addEventListener('load', alignPngOrigins, true);
document.addEventListener('scroll', alignPngOrigins, { capture: true, passive: true });
function watchDensity() {
  const density = window.devicePixelRatio || 1;
  document.documentElement.style.setProperty('--dpr', String(density));
  const variant = variants.reduce((best, item) => Math.abs(item.scale - density * 100) < Math.abs(best.scale - density * 100) ? item : best);
  for (const img of document.querySelectorAll('[data-tree-icon]')) {
    img.src = 'png/' + variant.size + '/' + img.dataset.treeIcon + '.png';
    img.width = img.height = variant.size;
    img.style.setProperty('--pixels', String(variant.size));
  }
  alignPngOrigins();
  matchMedia('(resolution: ' + density + 'dppx)').addEventListener('change', watchDensity, { once: true });
}
watchDensity();
</script>
</body></html>
`;
}

// Превью одним SVG-файлом: каждая иконка встроена один раз символом <symbol> в векторе и выводится через <use>.
// Без внешних файлов и data-URI, чтобы GitHub показывал его и в просмотре файла, и в README.
function previewSvg(icons) {
  const FONT = 'Segoe UI, -apple-system, Helvetica, Arial, sans-serif';
  const HEAD = 36;
  const ROW = 72;
  const FOOT = 44;
  const NAME_W = 268;
  const DARK_W = 256;
  const cells = [];
  let x = NAME_W;
  for (const size of PREVIEW_SIZES) {
    cells.push({ size, x, width: size + 12, grid: VARIANTS.find((variant) => variant.size === size).grid });
    x += size + 12;
  }
  const darkX = x;
  const width = darkX + DARK_W;
  const height = HEAD + ROW * icons.length + FOOT;

  const sourceGrid = (icon, grid) => selectSourceGrid(Object.keys(icon.sources).map(Number), grid);
  const symbols = icons.flatMap((icon) =>
    [...new Set([16, ...cells.map((cell) => cell.grid)].map((grid) => sourceGrid(icon, grid)))].map((source) => {
      const body = icon.sources[source].replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
      return `<symbol id="i${source}-${icon.name}" viewBox="0 0 ${source} ${source}">${body}</symbol>`;
    }),
  );

  const rows = icons.map((icon, index) => {
    const top = HEAD + ROW * index;
    const use = (grid, size, ux, uy) => `<use href="#i${sourceGrid(icon, grid)}-${icon.name}" x="${ux}" y="${uy}" width="${size}" height="${size}"/>`;
    return [
      use(16, 16, 12, top + 20),
      `<text x="34" y="${top + 33}" font-size="13">${escapeXml(icon.title)}</text>`,
      `<text x="34" y="${top + 52}" font-size="10" fill="#57606a">${escapeXml(icon.picture ?? icon.name)}</text>`,
      ...cells.map((cell) => use(cell.grid, cell.size, cell.x + 6, top + (ROW - cell.size) / 2)),
      use(16, 16, darkX + 12, top + 28),
      `<text x="${darkX + 34}" y="${top + 41}" font-size="13" fill="#e6e6e6">${escapeXml(icon.title)}</text>`,
      `<path d="M0 ${top + ROW + 0.5}H${darkX}" stroke="#d0d7de"/><path d="M${darkX} ${top + ROW + 0.5}H${width}" stroke="#3c3c3c"/>`,
    ].join('');
  });

  const header = [
    `<rect width="${width}" height="${HEAD}" fill="#f6f8fa"/>`,
    `<text x="12" y="23" font-size="13" font-weight="600">Вид метаданных</text>`,
    ...cells.map((cell) => `<text x="${cell.x + cell.width / 2}" y="23" font-size="13" font-weight="600" text-anchor="middle">${cell.size}</text>`),
    `<text x="${darkX + 12}" y="23" font-size="13" font-weight="600">На тёмном фоне</text>`,
    `<path d="M0 ${HEAD - 0.5}H${width}" stroke="#d0d7de"/>`,
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}" fill="#1f2328">
<title>Иконки метаданных 1С — превью</title>
<defs>
${symbols.join('\n')}
</defs>
<rect width="${width}" height="${height}" fill="#ffffff"/>
<rect x="${darkX}" y="${HEAD}" width="${DARK_W}" height="${ROW * icons.length}" fill="#252526"/>
${header.join('\n')}
${rows.join('\n')}
<path d="M${NAME_W - 0.5} 0V${HEAD + ROW * icons.length}" stroke="#d0d7de"/>
<text x="12" y="${height - 25}" font-size="12" fill="#57606a">Иконки метаданных 1С © 2026 Журавлев Анатолий, CC BY 4.0.</text>
<text x="12" y="${height - 9}" font-size="11" fill="#57606a">Исходники: 16, 20, 24 и 32 px. Размер 14 px — из 16; 28, 48 и 64 px — из 32.</text>
<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" fill="none" stroke="#d0d7de"/>
</svg>
`;
}

function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

await main();
