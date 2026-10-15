// SPDX-License-Identifier: MIT
// Сайт иконок метаданных 1С: тема, масштаб, поиск, панель иконки и копирование имени картинки.
// Данные об иконках и вариантах картинки встраивает scripts/site.mjs в <script id="data">.

const data = JSON.parse(document.getElementById('data').textContent);
const root = document.documentElement;
const grid = document.getElementById('grid');
const cards = [...grid.querySelectorAll('.card')];
const icons = new Map(data.icons.map((icon) => [icon.name, icon]));
const panel = document.getElementById('panel');
const panelBody = document.getElementById('panel-body');
const search = document.getElementById('search');
const toast = document.getElementById('toast');
// Иконка, открытая в панели
let current = null;

// Настройки посетителя хранятся в браузере; без localStorage сайт работает с настройками по умолчанию
function load(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // приватный режим или запрет хранилища: настройка просто не запомнится
  }
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Тема: по умолчанию как в системе, выбор на сайте запоминается

const themeButton = document.getElementById('theme');
const systemDark = matchMedia('(prefers-color-scheme: dark)');

function currentTheme() {
  return root.dataset.theme ?? (systemDark.matches ? 'dark' : 'light');
}

function showTheme() {
  const theme = currentTheme();
  const label = theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему';
  themeButton.dataset.current = theme;
  themeButton.title = label;
  themeButton.setAttribute('aria-label', label);
}

themeButton.addEventListener('click', () => {
  const theme = currentTheme() === 'dark' ? 'light' : 'dark';
  root.dataset.theme = theme;
  save('theme', theme);
  showTheme();
});
systemDark.addEventListener('change', showTheme);
showTheme();

// Плотность экрана: PNG выводятся пиксель в пиксель, поэтому их CSS-размер делится на devicePixelRatio.
// Плотность меняется при масштабировании страницы и переносе окна на другой монитор.

function watchDensity() {
  root.style.setProperty('--dpr', String(devicePixelRatio));
  if (current) {
    renderTree(current);
  }
  matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', watchDensity, { once: true });
}
watchDensity();

// Вариант, ближайший к масштабу: его 1С выбрала бы для экрана с такой плотностью
function nearest(list, target) {
  return list.reduce((best, item) => (Math.abs(item.scale - target) < Math.abs(best.scale - target) ? item : best));
}

// CSS-размер, при котором PNG выводится пиксель в пиксель
function pixelSize(size) {
  return `width:calc(${size}px / var(--dpr));height:calc(${size}px / var(--dpr))`;
}

// Масштаб интерфейса 1С: 100% — PNG 16 px, 125% — 20 px и так далее

let scale = data.scales[0];
const scaleInputs = [...document.querySelectorAll('input[name="scale"]')];

function setScale(value) {
  scale = data.scales.find((item) => item.scale === value) ?? data.scales[0];
  for (const input of scaleInputs) {
    input.checked = Number(input.value) === scale.scale;
  }
  for (const img of grid.querySelectorAll('img.icon')) {
    img.src = `png/${scale.size}/${img.dataset.name}.png`;
    img.width = scale.size;
    img.height = scale.size;
  }
  root.style.setProperty('--size', String(scale.size));
}

// По умолчанию — масштаб, ближайший к масштабу экрана: на экране 150% иконки выглядят как в 1С на этом экране
function defaultScale() {
  const stored = Number(load('scale'));
  if (data.scales.some((item) => item.scale === stored)) {
    return stored;
  }
  return nearest(data.scales, devicePixelRatio * 100).scale;
}

for (const input of scaleInputs) {
  input.addEventListener('change', () => {
    setScale(Number(input.value));
    save('scale', input.value);
  });
}
setScale(defaultScale());

// Поиск по названию вида, имени картинки и имени файла, без учёта регистра и «ё»

const count = document.getElementById('count');
const empty = document.getElementById('empty');

function normalize(text) {
  return text.toLowerCase().replaceAll('ё', 'е');
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function filter() {
  const words = normalize(search.value).split(/\s+/).filter(Boolean);
  let shown = 0;
  for (const card of cards) {
    const match = words.every((word) => card.dataset.search.includes(word));
    card.hidden = !match;
    if (match) shown += 1;
  }
  count.textContent = words.length
    ? `${shown} из ${cards.length}`
    : `${cards.length} ${plural(cards.length, 'иконка', 'иконки', 'иконок')}`;
  empty.hidden = shown > 0;
}

search.addEventListener('input', filter);
filter();

// «/» — к поиску, как на GitHub
document.addEventListener('keydown', (event) => {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || panel.open) return;
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable) return;
  event.preventDefault();
  search.focus();
  search.select();
});

// Копирование в буфер обмена

let toastTimer;

function showToast(text) {
  toast.textContent = text;
  clearTimeout(toastTimer);
  if (typeof toast.showPopover === 'function') {
    // Всплывающий слой выводится поверх открытой панели
    if (toast.matches(':popover-open')) toast.hidePopover();
    toast.showPopover();
    toastTimer = setTimeout(() => toast.hidePopover(), 2200);
  } else {
    toast.classList.add('shown');
    toastTimer = setTimeout(() => toast.classList.remove('shown'), 2200);
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Без Clipboard API (страница открыта не по https): через выделение текста.
    // Пока открыта модальная панель, остальная страница недоступна, поэтому поле добавляется в панель.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    (panel.open ? panel : document.body).append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) {
      showToast('Не удалось скопировать');
      return;
    }
  }
  showToast(`Скопировано: ${text}`);
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-copy]');
  if (button) {
    copyText(button.dataset.copy);
  }
});

// Панель иконки: все размеры, вид в дереве метаданных, скачивание. Адрес …/#role открывает её сразу.

function pngUrl(size, name) {
  return `png/${size}/${name}.png`;
}

function renderPanel(icon) {
  const code = `БиблиотекаКартинок.${icon.picture}`;
  const zoom = icon.grids
    .map((grid) => {
      const factor = 64 / grid;
      return `<figure><img src="${pngUrl(grid, icon.name)}" alt="" width="64" height="64"><figcaption>${grid} px ×${factor}</figcaption></figure>`;
    })
    .join('');
  const sizes = (theme) =>
    `<div class="sizes swatch-${theme}">${data.variants
      .map(
        (variant) =>
          `<figure><img src="${pngUrl(variant.size, icon.name)}" alt="" width="${variant.size}" height="${variant.size}" style="${pixelSize(variant.size)}"><figcaption>${variant.size} px · ${variant.scale}%</figcaption></figure>`,
      )
      .join('')}</div>`;
  const pngLinks = data.variants
    .map(
      (variant) =>
        `<a class="button" href="${pngUrl(variant.size, icon.name)}" download="${icon.name}_${variant.size}px.png" title="Масштаб ${variant.scale}%">${variant.size}</a>`,
    )
    .join('');
  const svgLinks = icon.grids
    .map(
      (grid) =>
        `<a class="button" href="svg/${grid}/${icon.name}.svg" download="${icon.name}_${grid}.svg" title="Исходник по сетке ${grid}×${grid}">${grid}×${grid}</a>`,
    )
    .join('');

  panelBody.innerHTML = `
<div class="panel-head">
  <div class="zoom">${zoom}</div>
  <div class="panel-title">
    <h2 id="panel-title">${escapeHtml(icon.title)}</h2>
    <div class="panel-code"><code>${escapeHtml(code)}</code><button class="button" type="button" data-copy="${escapeHtml(code)}">Скопировать</button></div>
    <div class="muted">Общая картинка <code>${escapeHtml(icon.picture)}</code>, файл <code>${escapeHtml(icon.name)}</code></div>
  </div>
</div>
<section class="panel-section">
  <h3>Размеры</h3>
  ${sizes('light')}
  ${sizes('dark')}
  <p class="muted">PNG показаны пиксель в пиксель. 14–20 px собраны из исходника 16×16, 24–64 px — из 32×32.</p>
</section>
<section class="panel-section">
  <h3>В дереве метаданных</h3>
  <div class="trees"><div class="tree swatch-light" data-tree></div><div class="tree swatch-dark" data-tree></div></div>
  <p class="muted">Масштаб <span id="tree-scale"></span> — как у этого экрана.</p>
</section>
<section class="panel-section">
  <h3>Скачать</h3>
  <div class="panel-downloads">
    <div class="download-row"><a class="button primary" href="1c/${icon.name}.zip" download>Картинка 1С (.zip)</a><span class="muted">PNG для масштабов 85–400% и manifest.xml, загружается в общую картинку</span></div>
    <div class="download-row"><span>PNG</span>${pngLinks}</div>
    <div class="download-row"><span>SVG</span>${svgLinks}</div>
  </div>
</section>`;
  renderTree(icon);
}

// Дерево: иконка с соседями по icons.json — порядок в нём как в дереве метаданных EDT.
// Масштаб берётся по плотности экрана, а не из переключателя: так дерево выглядит как в 1С на этом мониторе.
function renderTree(icon) {
  const variant = nearest(data.variants, devicePixelRatio * 100);
  const index = data.icons.indexOf(icon);
  const start = Math.max(0, Math.min(index - 1, data.icons.length - 3));
  const rows = data.icons
    .slice(start, start + 3)
    .map(
      (item) =>
        `<div class="tree-row${item === icon ? ' selected' : ''}"><img src="${pngUrl(variant.size, item.name)}" alt="" width="${variant.size}" height="${variant.size}" style="${pixelSize(variant.size)}"><span>${escapeHtml(item.title)}</span></div>`,
    )
    .join('');
  for (const tree of panelBody.querySelectorAll('[data-tree]')) {
    tree.innerHTML = rows;
  }
  panelBody.querySelector('#tree-scale').textContent = `${variant.scale}%`;
}

function openPanel(name) {
  const icon = icons.get(name);
  if (!icon) return;
  current = icon;
  renderPanel(icon);
  if (!panel.open) {
    panel.showModal();
  }
  panelBody.scrollTop = 0;
  panel.scrollTop = 0;
  document.title = `${icon.title} — Иконки метаданных 1С`;
  if (location.hash !== `#${name}`) {
    history.replaceState(null, '', `#${name}`);
  }
}

// Соседняя иконка среди показанных поиском
function step(direction) {
  const visible = cards.filter((card) => !card.hidden).map((card) => card.dataset.name);
  const list = visible.includes(current.name) ? visible : cards.map((card) => card.dataset.name);
  const index = list.indexOf(current.name);
  openPanel(list[(index + direction + list.length) % list.length]);
}

const pageTitle = document.title;

panel.addEventListener('close', () => {
  current = null;
  document.title = pageTitle;
  history.replaceState(null, '', location.pathname + location.search);
});

panel.addEventListener('click', (event) => {
  // Щелчок по затемнению вокруг панели
  if (event.target === panel) {
    panel.close();
    return;
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'close') panel.close();
  if (action === 'prev') step(-1);
  if (action === 'next') step(1);
});

panel.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.key === 'ArrowLeft') step(-1);
  if (event.key === 'ArrowRight') step(1);
});

grid.addEventListener('click', (event) => {
  const link = event.target.closest('.card-open');
  // Ctrl/Shift/средняя кнопка — открыть иконку в новой вкладке, как обычную ссылку
  if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  openPanel(link.closest('.card').dataset.name);
});

function openFromHash() {
  const name = decodeURIComponent(location.hash.slice(1));
  if (icons.has(name)) {
    openPanel(name);
  } else if (panel.open) {
    panel.close();
  }
}

window.addEventListener('hashchange', openFromHash);
openFromHash();
