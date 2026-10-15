// SPDX-License-Identifier: MIT
// Сборка .cf для Конфигуратора: конфигурация, в которой есть только общие картинки, для «Сравнить, объединить с конфигурацией из файла».
// Работает только в Windows с установленными 1C:EDT и платформой «1С:Предприятие»; сначала npm run build.
// Цепочка: пустая база → XML → проект EDT (1cedtcli import) → картинки (export-edt.mjs) → XML (1cedtcli export) → база → .cf.
// XML для Конфигуратора порождает сам EDT. Затем проверка: из .cf создаётся новая база, и её картинки побайтно сравниваются со сборкой.
// Пути к инструментам определяются сами; переопределить: V8_DESIGNER (1cv8.exe), EDT_CLI (1cedtcli.exe), EDT_JAVA_HOME (JDK для EDT).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from './zip.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workDir = path.join(root, 'dist', 'cf-work');
const outFile = path.join(root, 'dist', 'release', '1c-metadata-icons.cf');
// Режим совместимости ниже платформы сборки, чтобы .cf открывался и в более старых платформах
const COMPATIBILITY_MODE = '8.3.14';
const CONFIG_NAME = 'ИконкиМетаданных1С';
const CONFIG_SYNONYM = 'Иконки метаданных 1С';
const VENDOR = 'Журавлев Анатолий';
const COMMENT = 'Иконки метаданных 1С © Журавлев Анатолий, CC BY 4.0';

async function main() {
  if (process.platform !== 'win32') {
    fail('Сборка .cf работает только в Windows: нужны 1C:EDT и платформа «1С:Предприятие».');
  }
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const icons = JSON.parse(await readFile(path.join(root, 'icons.json'), 'utf8')).filter((icon) => icon.picture);
  const notBuilt = icons.filter((icon) => !existsSync(builtZip(icon)));
  if (notBuilt.length > 0) {
    fail(`Нет архивов в dist/1c: ${notBuilt.map((icon) => icon.name).join(', ')}. Сначала выполните npm run build.`);
  }
  const designer = findDesigner();
  const edt = findEdt();
  console.log(`Конфигуратор: ${designer.exe}`);
  console.log(`EDT CLI: ${edt.cli}`);
  console.log(`Java для EDT: ${edt.javaHome}`);

  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });
  await mkdir(path.dirname(outFile), { recursive: true });
  const ib = path.join(workDir, 'ib');
  const emptyXml = path.join(workDir, 'xml-empty');
  const project = path.join(workDir, 'project');
  const xml = path.join(workDir, 'xml');

  step('Пустая информационная база и её XML');
  createInfobase(designer, ib);
  runDesigner(designer, ib, ['/DumpConfigToFiles', quote(emptyXml)], 'dump-empty');

  step('Проект EDT с картинками');
  runEdt(edt, ['import', '--version', designer.edtVersion, '--configuration-files', emptyXml, '--project', project]);
  const exported = spawnSync(process.execPath, [path.join(root, 'scripts', 'export-edt.mjs'), project], { encoding: 'utf8' });
  if (exported.status !== 0) {
    fail(`Выгрузка картинок в проект EDT не удалась:\n${exported.stdout}${exported.stderr}`);
  }
  await setConfigurationProperties(path.join(project, 'src', 'Configuration', 'Configuration.mdo'), version);
  runEdt(edt, ['export', '--project', project, '--configuration-files', xml]);

  step('Загрузка XML в базу и сохранение .cf');
  runDesigner(designer, ib, ['/LoadConfigFromFiles', quote(xml)], 'load');
  await rm(outFile, { force: true });
  runDesigner(designer, ib, ['/DumpCfg', quote(outFile)], 'dump-cf');

  step('Проверка: новая база из .cf');
  const checkIb = path.join(workDir, 'check-ib');
  const checkXml = path.join(workDir, 'check-xml');
  createInfobase(designer, checkIb, outFile);
  runDesigner(designer, checkIb, ['/DumpConfigToFiles', quote(checkXml)], 'check-dump');
  await verify(icons, checkXml, version);

  const size = Math.round((await stat(outFile)).size / 1024);
  console.log(
    `Готово: dist/release/1c-metadata-icons.cf, ${size} КБ, картинок: ${icons.length}, ` +
      `платформа сборки ${designer.version}, режим совместимости ${COMPATIBILITY_MODE}`,
  );
}

// Самая старая установленная платформа не ниже режима совместимости: .cf откроется на большем числе версий
function findDesigner() {
  const fromEnv = process.env.V8_DESIGNER;
  const candidates = fromEnv ? [fromEnv] : installedDesigners();
  const exe = candidates.find((file) => existsSync(file));
  if (!exe) {
    fail(
      fromEnv
        ? `Не найден ${fromEnv} из переменной V8_DESIGNER.`
        : `Не найден 1cv8.exe платформы ${COMPATIBILITY_MODE} или новее. Задайте путь в переменной V8_DESIGNER.`,
    );
  }
  const version = path.basename(path.dirname(path.dirname(exe)));
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) {
    fail(`Не удалось определить версию платформы по пути ${exe}: ожидается …\\<версия>\\bin\\1cv8.exe.`);
  }
  return { exe, version, edtVersion: version.split('.').slice(0, 3).join('.') };
}

function installedDesigners() {
  const base = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', '1cv8');
  if (!existsSync(base)) {
    return [];
  }
  return readdirSync(base)
    .filter((name) => /^\d+\.\d+\.\d+\.\d+$/.test(name) && compareVersions(name, COMPATIBILITY_MODE) >= 0)
    .sort(compareVersions)
    .map((name) => path.join(base, name, 'bin', '1cv8.exe'));
}

function findEdt() {
  const installations = path.join(process.env.LOCALAPPDATA ?? '', '1C', '1cedtstart', 'installations');
  const cli =
    process.env.EDT_CLI ??
    latest(installations, (name) => path.join(installations, name, '1cedt', '1cedtcli.exe'));
  if (!cli || !existsSync(cli)) {
    fail('Не найден 1cedtcli.exe. Установите 1C:EDT через 1C:EDT Start или задайте путь в переменной EDT_CLI.');
  }
  // EDT нужна своя JDK; java из PATH может оказаться старой, тогда 1cedtcli покажет окно с ошибкой
  const components = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', '1C', '1CE', 'components');
  const javaHome =
    process.env.EDT_JAVA_HOME ??
    latest(components, (name) => (/jdk/i.test(name) ? path.join(components, name) : undefined));
  if (!javaHome || !existsSync(path.join(javaHome, 'bin', 'java.exe'))) {
    fail('Не найдена JDK для 1C:EDT. Задайте каталог JDK в переменной EDT_JAVA_HOME.');
  }
  return { cli, javaHome };
}

// Последний по алфавиту подходящий путь в каталоге: у EDT и JDK в имени папки версия
function latest(dir, toPath) {
  if (!existsSync(dir)) {
    return undefined;
  }
  return readdirSync(dir)
    .sort()
    .reverse()
    .map(toPath)
    .find((file) => file && existsSync(file));
}

function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function createInfobase(designer, ib, template) {
  const args = ['CREATEINFOBASE', `File=${quote(ib)}`];
  if (template) {
    args.push('/UseTemplate', quote(template));
  }
  runV8(designer, args, template ? 'check-create' : 'create');
}

function runDesigner(designer, ib, args, logName) {
  runV8(designer, ['DESIGNER', '/F', quote(ib), '/DisableStartupMessages', ...args], logName);
}

// 1cv8 сам разбирает командную строку и не понимает экранирование \", поэтому аргументы передаются как есть, с кавычками вокруг путей
function runV8(designer, args, logName) {
  const log = path.join(workDir, `${logName}.log`);
  const result = spawnSync(designer.exe, [...args, '/Out', quote(log), '/DisableStartupDialogs'], {
    argv0: quote(designer.exe),
    windowsVerbatimArguments: true,
  });
  if (result.status !== 0) {
    const text = existsSync(log) ? readFileSync(log, 'utf8').replace(/^\uFEFF/, '') : '';
    fail(`Платформа завершилась с кодом ${result.status}: 1cv8 ${args.join(' ')}\n${text}`);
  }
}

function runEdt(edt, command) {
  const env = { ...process.env, JAVA_HOME: edt.javaHome };
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = `${path.join(edt.javaHome, 'bin')};${env[pathKey] ?? ''}`;
  const result = spawnSync(edt.cli, ['-data', path.join(workDir, 'edt-workspace'), '-command', ...command], { env });
  if (result.status !== 0) {
    // 1cedtcli пишет в кодировке консоли
    const output = new TextDecoder('ibm866').decode(Buffer.concat([result.stdout ?? Buffer.alloc(0), result.stderr ?? Buffer.alloc(0)]));
    fail(`1cedtcli ${command[0]} завершился с кодом ${result.status}.\n${output}`);
  }
}

// Имя, синоним, автор, версия и режим совместимости собираемой конфигурации
async function setConfigurationProperties(file, version) {
  let text = await readFile(file, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const replace = (pattern, replacement, what) => {
    if (!pattern.test(text)) {
      fail(`В ${file} не найдено ${what}: формат проекта EDT изменился.`);
    }
    text = text.replace(pattern, replacement);
  };
  replace(
    /^([ \t]*)<name>[^<]*<\/name>\r?\n/m,
    (_, indent) =>
      [
        `<name>${CONFIG_NAME}</name>`,
        '<synonym>',
        '  <key>ru</key>',
        `  <value>${CONFIG_SYNONYM}</value>`,
        '</synonym>',
        `<comment>${COMMENT}</comment>`,
      ]
        .map((line) => indent + line + eol)
        .join(''),
    'имя конфигурации',
  );
  replace(
    /^([ \t]*)(<scriptVariant>[^<]*<\/scriptVariant>\r?\n)/m,
    (_, indent, line) => `${indent}${line}${indent}<vendor>${VENDOR}</vendor>${eol}${indent}<version>${version}</version>${eol}`,
    'вариант встроенного языка',
  );
  replace(/<compatibilityMode>[^<]*</, `<compatibilityMode>${COMPATIBILITY_MODE}<`, 'режим совместимости');
  replace(
    /<configurationExtensionCompatibilityMode>[^<]*</,
    `<configurationExtensionCompatibilityMode>${COMPATIBILITY_MODE}<`,
    'режим совместимости расширений',
  );
  await writeFile(file, text);
}

// Картинки в базе, созданной из .cf, должны побайтно совпадать со сборкой
async function verify(icons, xml, version) {
  const problems = [];
  const pictures = (await readdir(path.join(xml, 'CommonPictures'))).filter((file) => file.endsWith('.xml'));
  if (pictures.length !== icons.length) {
    problems.push(`общих картинок ${pictures.length}, а должно быть ${icons.length}`);
  }
  for (const icon of icons) {
    const file = path.join(xml, 'CommonPictures', icon.picture, 'Ext', 'Picture', 'Picture.zip');
    if (!existsSync(file)) {
      problems.push(`${icon.picture}: нет картинки`);
      continue;
    }
    const expected = readZip(await readFile(builtZip(icon)));
    const actual = readZip(await readFile(file));
    const names = [...expected.keys()].sort();
    const same =
      names.length === actual.size && names.every((name) => actual.has(name) && actual.get(name).equals(expected.get(name)));
    if (!same) {
      problems.push(`${icon.picture}: содержимое отличается от dist/1c/${icon.name}.zip`);
    }
  }
  const config = await readFile(path.join(xml, 'Configuration.xml'), 'utf8');
  for (const expected of [`<Name>${CONFIG_NAME}</Name>`, `<Version>${version}</Version>`, `<CompatibilityMode>Version${COMPATIBILITY_MODE.replaceAll('.', '_')}</CompatibilityMode>`]) {
    if (!config.includes(expected)) {
      problems.push(`в свойствах конфигурации нет ${expected}`);
    }
  }
  if (problems.length > 0) {
    fail(`Проверка .cf не пройдена:\n- ${problems.join('\n- ')}`);
  }
  console.log(`  картинок в .cf: ${icons.length}, все совпадают со сборкой`);
}

function builtZip(icon) {
  return path.join(root, 'dist', '1c', `${icon.name}.zip`);
}

function quote(value) {
  return `"${value}"`;
}

function step(title) {
  console.log(`${title}…`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

await main();
