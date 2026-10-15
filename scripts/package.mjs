// SPDX-License-Identifier: MIT
// Архив релиза с картинками: архивы картинок 1С из dist/1c для EDT и Конфигуратора, скрипт выгрузки в EDT,
// список иконок, лицензии и README с установкой Node.js.
// Раскладка повторяет репозиторий, поэтому scripts/export-edt.mjs работает в распакованном архиве без изменений.
// npm run package — сначала собирает иконки, результат в dist/release/1c-metadata-icons-pictures.zip
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipStored } from './zip.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Имя без версии, чтобы ссылка …/releases/latest/download/<имя> всегда вела на свежий архив
const NAME = '1c-metadata-icons-pictures';
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

async function main() {
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const icons = JSON.parse(await readFile(path.join(root, 'icons.json'), 'utf8'));
  const notBuilt = icons.filter((icon) => !existsSync(path.join(root, 'dist', '1c', `${icon.name}.zip`)));
  if (notBuilt.length > 0) {
    fail(`Нет архивов в dist/1c: ${notBuilt.map((icon) => icon.name).join(', ')}. Сначала выполните npm run build.`);
  }

  // README читают в Блокноте Windows: CRLF и BOM, чтобы кириллица открывалась без настроек
  const readme = (await readFile(path.join(root, 'release', 'README.txt'), 'utf8'))
    .replaceAll('{{version}}', version)
    .replaceAll('{{count}}', String(icons.length))
    .replace(/\r?\n/g, '\r\n');

  const files = [
    { name: 'README.txt', data: Buffer.concat([BOM, Buffer.from(readme, 'utf8')]) },
    { name: 'LICENSE', data: await readFile(path.join(root, 'LICENSE')) },
    { name: 'icons.json', data: await readFile(path.join(root, 'icons.json')) },
    { name: 'scripts/export-edt.mjs', data: await readFile(path.join(root, 'scripts', 'export-edt.mjs')) },
    { name: 'scripts/LICENSE', data: await readFile(path.join(root, 'scripts', 'LICENSE')) },
  ];
  for (const icon of icons) {
    files.push({ name: `pictures/${icon.name}.zip`, data: await readFile(path.join(root, 'dist', '1c', `${icon.name}.zip`)) });
  }

  const zip = zipStored(files.map((file) => ({ ...file, name: `${NAME}/${file.name}` })));
  const outDir = path.join(root, 'dist', 'release');
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, `${NAME}.zip`), zip);
  console.log(`Архив релиза ${version}: dist/release/${NAME}.zip, файлов: ${files.length}, ${Math.round(zip.length / 1024)} КБ`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

await main();
