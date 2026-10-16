// SPDX-License-Identifier: MIT
// Сайт для GitHub Pages: галерея иконок с поиском, темой и масштабом, скачивание картинок 1С, PNG и SVG.
// Собирается из результатов npm run build в dist/site; site.css и site.js копируются из scripts/site.
// npm run site — сначала собирает иконки
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCE_GRIDS, VARIANTS } from './variants.mjs';
import { zipStored } from './zip.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const siteDir = path.join(distDir, 'site');
const assetsDir = path.join(root, 'scripts', 'site');

const REPO = 'https://github.com/Heart-Machine/1c-metadata-icons';
const RELEASE = `${REPO}/releases/latest`;
// Архив PNG и SVG собирается вместе с сайтом, из той же версии репозитория
const IMAGES = '1c-metadata-icons-png-svg';
// Масштабы в переключателе сайта; в панели иконки показываются все варианты
const SCALES = [100, 125, 150, 200, 300, 400];

async function main() {
  const icons = JSON.parse(await readFile(path.join(root, 'icons.json'), 'utf8'));
  for (const icon of icons) {
    icon.grids = SOURCE_GRIDS.filter((grid) => existsSync(path.join(root, 'src', String(grid), `${icon.name}.svg`)));
  }
  const drawn = icons.filter((icon) => icon.grids.length > 0);
  const missing = icons.filter((icon) => icon.grids.length === 0);
  const notBuilt = drawn.filter((icon) => !existsSync(path.join(distDir, '1c', `${icon.name}.zip`)));
  if (notBuilt.length > 0) {
    fail(`Нет архивов в dist/1c: ${notBuilt.map((icon) => icon.name).join(', ')}. Сначала выполните npm run build.`);
  }

  await rm(siteDir, { recursive: true, force: true });
  const images = [
    { name: 'LICENSE', data: await readFile(path.join(root, 'LICENSE')) },
    { name: 'icons.json', data: await readFile(path.join(root, 'icons.json')) },
  ];
  for (const icon of drawn) {
    await copy(path.join(distDir, '1c', `${icon.name}.zip`), path.join('1c', `${icon.name}.zip`));
    for (const { size } of VARIANTS) {
      const file = path.join('png', String(size), `${icon.name}.png`);
      images.push({ name: toPosix(file), data: await copy(path.join(distDir, file), file) });
    }
    for (const grid of icon.grids) {
      const file = path.join('svg', String(grid), `${icon.name}.svg`);
      images.push({ name: toPosix(file), data: await copy(path.join(root, 'src', String(grid), `${icon.name}.svg`), file) });
    }
  }
  images.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  await writeOut(`${IMAGES}.zip`, zipStored(images.map((file) => ({ ...file, name: `${IMAGES}/${file.name}` }))));

  const assets = {};
  for (const name of ['site.css', 'site.js']) {
    const data = await readFile(path.join(assetsDir, name));
    await writeOut(name, data);
    // Pages кэширует файлы на 10 минут: хэш в ссылке сразу подтягивает новые стили и скрипт
    assets[name] = `${name}?v=${createHash('sha256').update(data).digest('hex').slice(0, 8)}`;
  }
  await writeOut('index.html', Buffer.from(indexHtml(drawn, missing, assets), 'utf8'));
  console.log(`Сайт: dist/site, иконок: ${drawn.length}, архив ${IMAGES}.zip: ${images.length} файлов`);
}

async function copy(from, relativePath) {
  const data = await readFile(from);
  await writeOut(relativePath, data);
  return data;
}

async function writeOut(relativePath, data) {
  const file = path.join(siteDir, relativePath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
}

function indexHtml(icons, missing, assets) {
  const data = {
    icons: icons.map(({ name, title, picture, grids }) => ({ name, title, picture, grids })),
    variants: VARIANTS.map(({ scale, size, grid }) => ({ scale, size, grid })),
    scales: SCALES.map((scale) => ({ scale, size: VARIANTS.find((variant) => variant.scale === scale).size })),
  };
  // Разметка карточек готова без скрипта, скрипт добавляет поиск, масштаб и панель иконки
  const cards = icons
    .map((icon) => {
      const search = normalize(`${icon.title} ${icon.picture} ${icon.name}`);
      const code = `БиблиотекаКартинок.${icon.picture}`;
      return `<li class="card" data-name="${icon.name}" data-search="${escapeHtml(search)}">
<a class="card-open" href="#${icon.name}"><span class="card-pic"><img class="icon" src="png/16/${icon.name}.png" alt="" width="16" height="16" data-name="${icon.name}"></span><span class="card-title">${escapeHtml(icon.title)}</span><code class="card-picture">${breakName(icon.picture)}</code></a>
<button class="copy" type="button" data-copy="${escapeHtml(code)}" title="Скопировать ${escapeHtml(code)}" aria-label="Скопировать ${escapeHtml(code)}">${COPY_ICON}</button>
</li>`;
    })
    .join('\n');
  const radios = SCALES.map(
    (scale) => `<label><input type="radio" name="scale" value="${scale}"${scale === 100 ? ' checked' : ''}><span>${scale}%</span></label>`,
  ).join('');
  const planned = missing.length
    ? `<section class="planned"><h2>В планах</h2><p>Ещё не нарисованы: ${missing.map((icon) => escapeHtml(icon.title)).join(', ')}.</p></section>`
    : '';
  const sha = process.env.GITHUB_SHA;
  const build = sha ? ` Сайт собран из <a href="${REPO}/commit/${sha}">${sha.slice(0, 7)}</a>.` : '';
  const description = `${icons.length} ${plural(icons.length, 'иконка', 'иконки', 'иконок')} видов метаданных 1С:Предприятие 8 в одном стиле: PNG 14–64 px, картинки 1С, конфигурация и расширение.`;

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Иконки метаданных 1С</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="svg/32/configuration.svg" type="image/svg+xml">
<link rel="stylesheet" href="${assets['site.css']}">
<script>try{const t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch{}</script>
<script src="${assets['site.js']}" defer></script>
</head>
<body>
<header class="top">
<div class="wrap top-row">
<a class="brand" href="./"><img src="svg/32/configuration.svg" alt="" width="28" height="28"><span>Иконки метаданных 1С</span></a>
<nav class="top-nav">
<a href="${REPO}">GitHub</a>
<fieldset class="theme-control" id="theme" disabled><legend class="visually-hidden">Тема оформления</legend><label><input type="radio" name="theme" value="system" checked><span>Системная</span></label><label><input type="radio" name="theme" value="light"><span>Светлая</span></label><label><input type="radio" name="theme" value="dark"><span>Тёмная</span></label></fieldset>
</nav>
</div>
</header>
<main class="wrap">
<section class="intro">
<h1>Иконки метаданных 1С</h1>
<p>${icons.length} ${plural(icons.length, 'иконка', 'иконки', 'иконок')} для видов метаданных 1С:Предприятие 8 в одном стиле: справочники, документы, регистры, подсистемы, роли, боты, реквизиты, формы и другие. Многие из этих видов не имеют стандартной картинки в библиотеке картинок платформы. Метафоры и цвета подобраны так, чтобы иконки смотрелись рядом со стандартными картинками 1C:EDT.</p>
<p>В конфигурацию иконки добавляются как общие картинки, в коде к ним обращаются так: <code>БиблиотекаКартинок.МетаданныеРоль</code>.</p>
<a class="gallery-jump" href="#gallery">Посмотреть иконки</a>
</section>
<section class="downloads" aria-labelledby="downloads-title">
<h2 id="downloads-title">Скачать всё</h2>
<ul class="download-list">
<li><a class="download" href="${RELEASE}/download/1c-metadata-icons-pictures.zip">${DOWNLOAD_ICON}<span><strong>Картинки 1С</strong> <span class="ext">.zip</span><small>Архивы общих картинок для EDT и Конфигуратора и скрипт выгрузки в проект EDT</small></span></a></li>
<li><a class="download" href="${RELEASE}/download/1c-metadata-icons.cf">${DOWNLOAD_ICON}<span><strong>Конфигурация</strong> <span class="ext">.cf</span><small>Для объединения со своей конфигурацией в Конфигураторе, платформа 8.3.14 и новее</small></span></a></li>
<li><a class="download" href="${RELEASE}/download/1c-metadata-icons.cfe">${DOWNLOAD_ICON}<span><strong>Расширение</strong> <span class="ext">.cfe</span><small>Те же картинки в расширении, для разработчиков своих расширений</small></span></a></li>
<li><a class="download" href="${IMAGES}.zip" download>${DOWNLOAD_ICON}<span><strong>PNG и SVG</strong> <span class="ext">.zip</span><small>PNG 14–64 px и SVG-исходники всех иконок, без файлов 1С</small></span></a></li>
</ul>
<p class="note">Файлы 1С — из <a href="${RELEASE}">последнего релиза</a>, как их загрузить — в <a href="${REPO}#скачать">README</a>. Архив PNG и SVG и картинки на этой странице собраны из текущей версии репозитория.</p>
</section>
<section class="gallery" id="gallery" aria-labelledby="gallery-title">
<h2 id="gallery-title" class="visually-hidden">Иконки</h2>
<div class="toolbar">
<label class="search">${SEARCH_ICON}<input id="search" type="search" placeholder="Поиск: роль, МетаданныеРоль, role" aria-label="Поиск по названию вида, имени картинки и файла" autocomplete="off" spellcheck="false"></label>
<fieldset class="scale"><legend>Масштаб</legend>${radios}</fieldset>
<span class="count" id="count" aria-live="polite"></span>
</div>
<ul class="grid" id="grid">
${cards}
</ul>
<div class="empty" id="empty" hidden><p>Ничего не найдено.</p><button class="button" id="clear-search" type="button">Сбросить поиск</button></div>
<p class="note">PNG на странице показаны пиксель в пиксель: иконка 24 px занимает 24 точки экрана. Для 100, 125 и 150% нарисованы отдельные исходники 16, 20 и 24 px; для 200–400% используется сетка 32×32.</p>
</section>
${planned}
</main>
<footer class="foot">
<div class="wrap">
<p>© 2026 Журавлев Анатолий. Иконки распространяются по лицензии <a href="https://creativecommons.org/licenses/by/4.0/deed.ru">CC BY 4.0</a>: их можно использовать, изменять и распространять при условии указания автора. Пример указания автора: «Иконки метаданных 1С © Журавлев Анатолий, CC BY 4.0».</p>
<p>Иконки нарисованы с нуля, графика платформы «1С:Предприятие» и 1C:EDT не копировалась. Код сборки и сайта распространяется по лицензии <a href="${REPO}/blob/main/scripts/LICENSE">MIT</a>. <a href="${REPO}">Исходники на GitHub</a>.${build}</p>
</div>
</footer>
<dialog class="panel" id="panel" aria-labelledby="panel-title">
<div class="panel-inner">
<div class="panel-bar">
<button type="button" class="icon-button" data-action="prev" title="Предыдущая иконка (←)" aria-label="Предыдущая иконка">${PREV_ICON}</button>
<button type="button" class="icon-button" data-action="next" title="Следующая иконка (→)" aria-label="Следующая иконка">${NEXT_ICON}</button>
<button type="button" class="icon-button" data-action="close" title="Закрыть (Esc)" aria-label="Закрыть" autofocus>${CLOSE_ICON}</button>
</div>
<div class="panel-body" id="panel-body"></div>
</div>
</dialog>
<div class="toast" id="toast" role="status" popover="manual"></div>
<script type="application/json" id="data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
</body>
</html>
`;
}

// Иконки интерфейса сайта: простые штриховые значки, цвет берётся из текста
const svgIcon = (body, extra = '') =>
  `<svg${extra} viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const COPY_ICON = svgIcon('<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-.5a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5"/>');
const DOWNLOAD_ICON = svgIcon('<path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11"/>', ' class="download-icon"');
const SEARCH_ICON = svgIcon('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/>');
const PREV_ICON = svgIcon('<path d="M10 3 5 8l5 5"/>');
const NEXT_ICON = svgIcon('<path d="m6 3 5 5-5 5"/>');
const CLOSE_ICON = svgIcon('<path d="m3.5 3.5 9 9M12.5 3.5l-9 9"/>');

// Строка для поиска: без учёта регистра и разницы между «е» и «ё», как в site.js
function normalize(text) {
  return text.toLowerCase().replaceAll('ё', 'е');
}

// Длинные имена картинок переносятся между словами: Метаданные<wbr>Параметр<wbr>Функциональных<wbr>Опций
function breakName(name) {
  return escapeHtml(name).replace(/(?<=[a-zа-яё])(?=[A-ZА-ЯЁ])/g, '<wbr>');
}

function plural(count, one, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toPosix(file) {
  return file.split(path.sep).join('/');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

await main();
