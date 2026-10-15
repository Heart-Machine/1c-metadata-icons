// SPDX-License-Identifier: MIT
// Выгрузка иконок в проект 1C:EDT: общие картинки из dist/1c и их регистрация в Configuration.mdo.
// node scripts/export-edt.mjs [--dry-run] [--prefix <префикс>] <каталог проекта EDT или его src>
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// По этому комментарию скрипт узнаёт свои картинки и не трогает чужие с тем же именем
const COMMENT = 'Иконки метаданных 1С © Журавлев Анатолий, CC BY 4.0';
// Элементы Configuration.mdo, которые идут после списка commonPictures; нужны, когда картинок ещё нет
const AFTER_PICTURES = ['interfaces', 'sessionParameters', 'roles', 'commonTemplates', 'filterCriteria', 'commonModules'];
const BEFORE_PICTURES = ['styles', 'styleItems', 'subsystems', 'languages'];

async function main() {
  const { dryRun, prefix, target } = parseArgs(process.argv.slice(2));
  const srcDir = [target, path.join(target, 'src')].find((dir) => existsSync(configPath(dir)));
  if (!srcDir) {
    fail(`Не найден Configuration/Configuration.mdo ни в ${target}, ни в ${path.join(target, 'src')}`);
  }
  const configFile = configPath(srcDir);

  const icons = JSON.parse(await readFile(path.join(root, 'icons.json'), 'utf8'))
    .filter((icon) => icon.picture)
    .map((icon) => ({ ...icon, picture: prefix + icon.picture }));
  const notBuilt = icons.filter((icon) => !existsSync(zipFile(icon)));
  if (notBuilt.length > 0) {
    fail(`Нет архивов в dist/1c: ${notBuilt.map((icon) => icon.name).join(', ')}. Сначала выполните npm run build.`);
  }

  // Сначала проверяем все картинки и только потом пишем, чтобы не оставить конфигурацию наполовину изменённой
  const plan = [];
  const foreign = [];
  for (const icon of icons) {
    const dir = path.join(srcDir, 'CommonPictures', icon.picture);
    const mdoFile = path.join(dir, `${icon.picture}.mdo`);
    const isNew = !existsSync(mdoFile);
    if (!isNew && !(await readFile(mdoFile, 'utf8')).includes(`<comment>${COMMENT}</comment>`)) {
      foreign.push(icon.picture);
      continue;
    }
    // Картинка хранится одним файлом Picture.*, прежний PNG или SVG мешал бы архиву
    const stale = existsSync(dir) ? (await readdir(dir)).filter((file) => /^Picture\./i.test(file) && file !== 'Picture.zip') : [];
    plan.push({ icon, dir, mdoFile, isNew, stale });
  }
  if (foreign.length > 0) {
    fail(
      `В конфигурации уже есть общие картинки с такими именами, созданные не этим скриптом: ${foreign.join(', ')}.\n` +
        'Файлы не изменены. Задайте префикс, например --prefix Мой_.',
    );
  }

  let config = await readFile(configFile, 'utf8');
  const eol = config.includes('\r\n') ? '\r\n' : '\n';
  const report = [];
  for (const { icon, dir, mdoFile, isNew, stale } of plan) {
    if (!dryRun) {
      await mkdir(dir, { recursive: true });
      // Существующий .mdo не перезаписываем: в нём UUID и правки, сделанные в EDT
      if (isNew) {
        await writeFile(mdoFile, mdo(icon, eol));
      }
      await copyFile(zipFile(icon), path.join(dir, 'Picture.zip'));
      for (const file of stale) {
        await rm(path.join(dir, file));
      }
    }
    const removed = stale.length > 0 ? `, удалено: ${stale.join(', ')}` : '';
    report.push(`${isNew ? 'новая    ' : 'обновлена'}  ${icon.picture}${removed}`);

    const registered = register(config, icon.picture, eol);
    if (registered !== config) {
      config = registered;
      report.push('           + в Configuration.mdo');
    }
  }
  if (!dryRun) {
    await writeFile(configFile, config);
  }

  console.log(report.join('\n'));
  console.log(`${dryRun ? 'Пробный запуск, файлы не изменены. ' : ''}Картинок: ${icons.length}, конфигурация: ${srcDir}`);
}

function parseArgs(args) {
  const result = { dryRun: false, prefix: '', target: undefined };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--prefix') {
      result.prefix = args[++i] ?? '';
    } else if (arg.startsWith('--prefix=')) {
      result.prefix = arg.slice('--prefix='.length);
    } else if (arg.startsWith('--')) {
      fail(`Неизвестный ключ ${arg}`);
    } else {
      result.target = arg;
    }
  }
  if (!result.target) {
    fail('Укажите каталог проекта EDT: node scripts/export-edt.mjs [--dry-run] [--prefix <префикс>] <каталог>');
  }
  // Имя общей картинки — идентификатор 1С: буквы, цифры и «_», первым символом не цифра
  if (result.prefix && !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(result.prefix)) {
    fail(`Префикс «${result.prefix}» не подходит для имени объекта 1С: допустимы буквы, цифры и «_», первым символом не цифра.`);
  }
  return result;
}

function configPath(srcDir) {
  return path.join(srcDir, 'Configuration', 'Configuration.mdo');
}

function zipFile(icon) {
  return path.join(root, 'dist', '1c', `${icon.name}.zip`);
}

function mdo(icon, eol) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<mdclass:CommonPicture xmlns:mdclass="http://g5.1c.ru/v8/dt/metadata/mdclass" uuid="${randomUUID()}">`,
    `  <name>${icon.picture}</name>`,
    '  <synonym>',
    '    <key>ru</key>',
    `    <value>${icon.title}</value>`,
    '  </synonym>',
    `  <comment>${COMMENT}</comment>`,
    '</mdclass:CommonPicture>',
    '',
  ].join(eol);
}

// Добавляет строку <commonPictures> в Configuration.mdo, сохраняя порядок по кодам символов, как в EDT
function register(config, name, eol) {
  if (config.includes(`<commonPictures>CommonPicture.${name}</commonPictures>`)) {
    return config;
  }
  const line = (indent) => `${indent}<commonPictures>CommonPicture.${name}</commonPictures>${eol}`;
  const entries = [...config.matchAll(/^([ \t]*)<commonPictures>CommonPicture\.([^<]+)<\/commonPictures>\r?\n/gm)];
  if (entries.length > 0) {
    const next = entries.find((entry) => entry[2] > name);
    const at = next ? next.index : entries.at(-1).index + entries.at(-1)[0].length;
    return config.slice(0, at) + line(entries[0][1]) + config.slice(at);
  }
  // Картинок ещё нет: ставим список перед первым следующим за ним элементом или после последнего предыдущего
  for (const tag of AFTER_PICTURES) {
    const match = new RegExp(`^([ \\t]*)<${tag}>`, 'm').exec(config);
    if (match) {
      return config.slice(0, match.index) + line(match[1]) + config.slice(match.index);
    }
  }
  for (const tag of BEFORE_PICTURES) {
    const matches = [...config.matchAll(new RegExp(`^([ \\t]*)<${tag}>.*\\r?\\n`, 'gm'))];
    if (matches.length > 0) {
      const last = matches.at(-1);
      const at = last.index + last[0].length;
      return config.slice(0, at) + line(last[1]) + config.slice(at);
    }
  }
  fail('Не удалось найти место для commonPictures в Configuration.mdo.');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

await main();
