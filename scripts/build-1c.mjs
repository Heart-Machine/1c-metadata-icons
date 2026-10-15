// SPDX-License-Identifier: MIT
// Сборка файлов 1С с общими картинками: .cf (конфигурация для «Сравнить, объединить с конфигурацией из файла»)
// и .cfe (расширение-дополнение). Работает только в Windows с установленными 1C:EDT и платформой «1С:Предприятие»;
// сначала npm run build.
// Цепочка: пустая база → XML → проекты EDT (1cedtcli import) → картинки (export-edt.mjs) → XML (1cedtcli export) → база → .cf/.cfe.
// XML для Конфигуратора порождает сам EDT. Затем проверка: .cf и .cfe загружаются в новые базы, расширение применяется
// к базе данных, и картинки побайтно сравниваются со сборкой.
// Пути к инструментам определяются сами; переопределить: V8_DESIGNER (1cv8.exe), EDT_CLI (1cedtcli.exe), EDT_JAVA_HOME (JDK для EDT).
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from './zip.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workDir = path.join(root, 'dist', '1c-work');
const releaseDir = path.join(root, 'dist', 'release');
const cfFile = path.join(releaseDir, '1c-metadata-icons.cf');
const cfeFile = path.join(releaseDir, '1c-metadata-icons.cfe');
// Режим совместимости ниже платформы сборки, чтобы файлы открывались и в более старых платформах
const COMPATIBILITY_MODE = '8.3.14';
const CONFIG_NAME = 'ИконкиМетаданных1С';
const CONFIG_SYNONYM = 'Иконки метаданных 1С';
const VENDOR = 'Журавлев Анатолий';
const COMMENT = 'Иконки метаданных 1С © Журавлев Анатолий, CC BY 4.0';
// Все имена картинок начинаются с «Метаданные», поэтому это и префикс имён расширения
const EXTENSION_PREFIX = 'Метаданные';

async function main() {
  if (process.platform !== 'win32') {
    fail('Сборка .cf и .cfe работает только в Windows: нужны 1C:EDT и платформа «1С:Предприятие».');
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
  await mkdir(releaseDir, { recursive: true });
  const dir = (name) => path.join(workDir, name);
  // EDT называет проект по имени каталога, базовый проект расширения ищется по этому имени
  const configProject = dir('configuration');
  const baseProject = dir('base');
  const extensionProject = dir('extension');

  step('Пустая информационная база и её XML');
  createInfobase(designer, dir('ib'), 'create');
  runDesigner(designer, dir('ib'), ['/DumpConfigToFiles', quote(dir('xml-empty'))], 'dump-empty');

  step('Проекты EDT: конфигурация и расширение с картинками');
  const importEmpty = (project) => ['import', '--version', designer.edtVersion, '--configuration-files', dir('xml-empty'), '--project', project];
  await runEdt(edt, [importEmpty(configProject), importEmpty(baseProject)], 'edt-import');
  exportPictures(configProject);
  await setConfigurationProperties(mdoPath(configProject), version);
  await createExtensionProject(extensionProject, baseProject, designer.edtVersion, version);
  exportPictures(extensionProject);
  await runEdt(
    edt,
    [
      ['export', '--project', configProject, '--configuration-files', dir('xml')],
      ['import', '--project', extensionProject],
      ['export', '--project', extensionProject, '--configuration-files', dir('xml-extension')],
    ],
    'edt-export',
  );

  step('Сохранение .cf');
  runDesigner(designer, dir('ib'), ['/LoadConfigFromFiles', quote(dir('xml'))], 'load-cf');
  await rm(cfFile, { force: true });
  runDesigner(designer, dir('ib'), ['/DumpCfg', quote(cfFile)], 'dump-cf');

  step('Сохранение .cfe');
  // Расширение собирается в отдельной пустой базе: в базе .cf уже есть картинки с теми же именами
  const extension = ['-Extension', CONFIG_NAME];
  createInfobase(designer, dir('ib-extension'), 'create-extension');
  runDesigner(designer, dir('ib-extension'), ['/LoadConfigFromFiles', quote(dir('xml-extension')), ...extension], 'load-cfe');
  await rm(cfeFile, { force: true });
  runDesigner(designer, dir('ib-extension'), ['/DumpCfg', quote(cfeFile), ...extension], 'dump-cfe');

  step('Проверка .cf: новая база из файла');
  createInfobase(designer, dir('check-cf'), 'check-cf-create', cfFile);
  runDesigner(designer, dir('check-cf'), ['/DumpConfigToFiles', quote(dir('check-cf-xml'))], 'check-cf-dump');
  await verify('.cf', icons, dir('check-cf-xml'), [
    `<Name>${CONFIG_NAME}</Name>`,
    `<Version>${version}</Version>`,
    `<CompatibilityMode>${compatibilityValue()}</CompatibilityMode>`,
  ]);

  step('Проверка .cfe: подключение к новой базе и применение к базе данных');
  createInfobase(designer, dir('check-cfe'), 'check-cfe-create');
  runDesigner(designer, dir('check-cfe'), ['/LoadCfg', quote(cfeFile), ...extension], 'check-cfe-load');
  runDesigner(designer, dir('check-cfe'), ['/UpdateDBCfg', ...extension], 'check-cfe-update');
  runDesigner(designer, dir('check-cfe'), ['/DumpConfigToFiles', quote(dir('check-cfe-xml')), ...extension], 'check-cfe-dump');
  await verify('.cfe', icons, dir('check-cfe-xml'), [
    '<ObjectBelonging>Adopted</ObjectBelonging>',
    `<Name>${CONFIG_NAME}</Name>`,
    `<NamePrefix>${EXTENSION_PREFIX}</NamePrefix>`,
    '<ConfigurationExtensionPurpose>AddOn</ConfigurationExtensionPurpose>',
    `<Version>${version}</Version>`,
    `<ConfigurationExtensionCompatibilityMode>${compatibilityValue()}</ConfigurationExtensionCompatibilityMode>`,
  ]);

  for (const file of [cfFile, cfeFile]) {
    const size = Math.round((await stat(file)).size / 1024);
    console.log(`Готово: dist/release/${path.basename(file)}, ${size} КБ`);
  }
  console.log(`Картинок: ${icons.length}, платформа сборки ${designer.version}, режим совместимости ${COMPATIBILITY_MODE}`);
}

// Самая старая установленная платформа не ниже режима совместимости: файлы откроются на большем числе версий
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

function compatibilityValue() {
  return `Version${COMPATIBILITY_MODE.replaceAll('.', '_')}`;
}

function createInfobase(designer, ib, logName, template) {
  const args = ['CREATEINFOBASE', `File=${quote(ib)}`];
  if (template) {
    args.push('/UseTemplate', quote(template));
  }
  runV8(designer, args, logName);
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

// Несколько команд за один запуск 1cedtcli: каждый запуск поднимает JVM и занимает 10–25 секунд
async function runEdt(edt, commands, name) {
  const script = path.join(workDir, `${name}.txt`);
  // В кавычках только пути: команда или значение в кавычках оболочка EDT разбирает как строку и не находит вариант вызова
  const line = (command) => command.map((arg) => (/[\\/ ]/.test(arg) ? `"${arg}"` : arg)).join(' ');
  await writeFile(script, commands.map(line).join('\n') + '\n');
  const env = { ...process.env, JAVA_HOME: edt.javaHome };
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = `${path.join(edt.javaHome, 'bin')};${env[pathKey] ?? ''}`;
  const result = spawnSync(edt.cli, ['-data', path.join(workDir, 'edt-workspace'), '-file', script], { env });
  if (result.status !== 0) {
    // 1cedtcli пишет в кодировке консоли
    const output = new TextDecoder('ibm866').decode(Buffer.concat([result.stdout ?? Buffer.alloc(0), result.stderr ?? Buffer.alloc(0)]));
    fail(`1cedtcli завершился с кодом ${result.status} на командах из ${script}.\n${output}`);
  }
}

function exportPictures(project) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'export-edt.mjs'), project], { encoding: 'utf8' });
  if (result.status !== 0) {
    fail(`Выгрузка картинок в проект EDT ${project} не удалась:\n${result.stdout}${result.stderr}`);
  }
}

function mdoPath(project) {
  return path.join(project, 'src', 'Configuration', 'Configuration.mdo');
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

// Проект расширения-дополнения поверх пустой базовой конфигурации. Язык заимствуется по имени, поэтому .cfe
// подключается к любой конфигурации с языком «Русский». Набор служебных объектов (containedObjects) зависит
// от версии платформы и берётся из базового проекта той же версии.
async function createExtensionProject(project, baseProject, runtime, version) {
  const classes = [...(await readFile(mdoPath(baseProject), 'utf8')).matchAll(/<containedObjects classId="([^"]+)"/g)].map(
    (match) => match[1],
  );
  if (classes.length === 0) {
    fail(`В ${mdoPath(baseProject)} нет containedObjects: формат проекта EDT изменился.`);
  }
  const crlf = (lines) => lines.join('\r\n') + '\r\n';
  await mkdir(path.join(project, 'DT-INF'), { recursive: true });
  await mkdir(path.join(project, 'src', 'Configuration'), { recursive: true });
  await writeFile(
    path.join(project, '.project'),
    crlf([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<projectDescription>',
      `\t<name>${path.basename(project)}</name>`,
      '\t<comment></comment>',
      '\t<projects>',
      '\t</projects>',
      '\t<buildSpec>',
      '\t\t<buildCommand>',
      '\t\t\t<name>org.eclipse.xtext.ui.shared.xtextBuilder</name>',
      '\t\t\t<arguments>',
      '\t\t\t</arguments>',
      '\t\t</buildCommand>',
      '\t</buildSpec>',
      '\t<natures>',
      '\t\t<nature>org.eclipse.xtext.ui.shared.xtextNature</nature>',
      '\t\t<nature>com._1c.g5.v8.dt.core.V8ExtensionNature</nature>',
      '\t</natures>',
      '</projectDescription>',
    ]),
  );
  await writeFile(
    path.join(project, 'DT-INF', 'PROJECT.PMF'),
    crlf(['Manifest-Version: 1.0', `Runtime-Version: ${runtime}`, `Base-Project: ${path.basename(baseProject)}`]),
  );
  await writeFile(
    mdoPath(project),
    crlf([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<mdclass:Configuration xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
        'xmlns:mdclass="http://g5.1c.ru/v8/dt/metadata/mdclass" ' +
        `xmlns:mdclassExtension="http://g5.1c.ru/v8/dt/metadata/mdclass/extension" uuid="${randomUUID()}">`,
      `  <name>${CONFIG_NAME}</name>`,
      '  <synonym>',
      '    <key>ru</key>',
      `    <value>${CONFIG_SYNONYM}</value>`,
      '  </synonym>',
      `  <comment>${COMMENT}</comment>`,
      '  <objectBelonging>Adopted</objectBelonging>',
      '  <extension xsi:type="mdclassExtension:ConfigurationExtension">',
      '    <defaultLanguage>Checked</defaultLanguage>',
      '  </extension>',
      ...classes.map((id) => `  <containedObjects classId="${id}" objectId="${randomUUID()}"/>`),
      `  <namePrefix>${EXTENSION_PREFIX}</namePrefix>`,
      `  <configurationExtensionCompatibilityMode>${COMPATIBILITY_MODE}</configurationExtensionCompatibilityMode>`,
      '  <configurationExtensionPurpose>AddOn</configurationExtensionPurpose>',
      '  <scriptVariant>Russian</scriptVariant>',
      `  <vendor>${VENDOR}</vendor>`,
      `  <version>${version}</version>`,
      '  <defaultLanguage>Language.Русский</defaultLanguage>',
      '  <dataLockControlMode>Managed</dataLockControlMode>',
      '  <objectAutonumerationMode>NotAutoFree</objectAutonumerationMode>',
      '  <synchronousPlatformExtensionAndAddInCallUseMode>DontUse</synchronousPlatformExtensionAndAddInCallUseMode>',
      `  <languages uuid="${randomUUID()}">`,
      '    <name>Русский</name>',
      '    <objectBelonging>Adopted</objectBelonging>',
      '    <extension xsi:type="mdclassExtension:LanguageExtension">',
      '      <languageCode>Checked</languageCode>',
      '    </extension>',
      '    <languageCode>ru</languageCode>',
      '  </languages>',
      '</mdclass:Configuration>',
    ]),
  );
}

// Картинки, выгруженные из базы, должны побайтно совпадать со сборкой, а свойства — с заданными
async function verify(kind, icons, xml, expectedProperties) {
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
  for (const expected of expectedProperties) {
    if (!config.includes(expected)) {
      problems.push(`в свойствах нет ${expected}`);
    }
  }
  if (problems.length > 0) {
    fail(`Проверка ${kind} не пройдена:\n- ${problems.join('\n- ')}`);
  }
  console.log(`  ${kind}: картинок ${icons.length}, все совпадают со сборкой`);
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
