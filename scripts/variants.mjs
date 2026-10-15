// SPDX-License-Identifier: MIT
// Самостоятельные исходники: маленькие сетки привязаны к пикселям для 100, 125 и 150%.
export const SOURCE_GRIDS = [16, 20, 24, 32];

// Варианты картинки 1С: плотность экрана, суффикс файла (масштаб, %), размер в пикселях, сетка исходника
export const VARIANTS = [
  { density: 'bldpi', scale: 85, size: 14, grid: 16 },
  { density: 'ldpi', scale: 100, size: 16, grid: 16 },
  { density: 'aldpi', scale: 125, size: 20, grid: 20 },
  { density: 'mdpi', scale: 150, size: 24, grid: 24 },
  { density: 'amdpi', scale: 175, size: 28, grid: 32 },
  { density: 'hdpi', scale: 200, size: 32, grid: 32 },
  { density: 'xdpi', scale: 300, size: 48, grid: 32 },
  { density: 'udpi', scale: 400, size: 64, grid: 32 },
];

// Пока отдельная сетка ещё не нарисована, сохраняем прежний выбор 16/32.
// Иконка с одним исходником по-прежнему собирается во всех размерах.
export function selectSourceGrid(available, requested) {
  const primary = requested <= 20 ? [16, 32] : [32, 16];
  return [requested, ...primary, ...SOURCE_GRIDS].find((grid) => available.includes(grid));
}
