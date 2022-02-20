import { spawn } from 'child_process';
import fs from 'fs';
import { Logger, Schema, Time } from 'koishi';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

export type ResolvedConfig = {
  gimpPath: string;
  inkscapePath: string;
  imgDir: string;
  tempOut: string;
  minInterval: number;
  authority: {
    upload: number;
    delete: number;
  };
};
type RecursivePartial<T> = {
  [P in keyof T]?: RecursivePartial<T[P]>;
};
export type Config = RecursivePartial<ResolvedConfig>;
export const Config: Schema<Config> = Schema.object({
  gimpPath: Schema.string()
    .description('GIMP 路径')
    .default(os.platform() === 'win32' ? 'gimp-console-2.10.exe' : 'gimp'),
  inkscapePath: Schema.string()
    .description('inkscape 路径')
    .default(os.platform() === 'win32' ? 'inkscape.com' : 'inkscape'),
  imgDir: Schema.string().description('梗图模板文件所在路径').default('memes'),
  tempOut: Schema.string()
    .description('生成的临时图片所在的路径')
    .default('temp.png'),
  minInterval: Schema.number()
    .description('梗图生成命令的速率限制')
    .default(Time.minute),
  authority: Schema.object({
    upload: Schema.number().description('添加模板').default(2),
    delete: Schema.number().description('删除模板').default(3),
  })
    .description('控制台权限需求')
    .default({}),
});
const logger = new Logger('meme');

function escapeScm(str: string): string {
  return str.replace('"', '\\"').replace('\\', '\\\\');
}

const TO_REPLACE_COND = '(gimp-message "JS Interpolation here")';
const TO_REPLACE_IN = 'IMAGE.xcf';
const TO_REPLACE_OUT = 'OUT.png';

const scmCond = (cond: string): string => `(cond ${cond})`;

function scmCondItem(name: string, value: string): string {
  const nameEsc = escapeScm(name),
    valueEsc = escapeScm(value);
  return `((equal? "${nameEsc}" curr-name) (gimp-text-layer-set-text curr-layer "${valueEsc}"))`;
}

function replaceScript(
  script: string,
  image: string,
  output: string,
  dict: Record<string, string>,
): string {
  const conditions = [];
  for (const name in dict) {
    conditions.push(scmCondItem(name, dict[name]));
  }
  script = script
    .replace(TO_REPLACE_IN, escapeScm(image))
    .replace(TO_REPLACE_OUT, escapeScm(output));
  if (!conditions.length) return script.replace(TO_REPLACE_COND, '');
  return script.replace(TO_REPLACE_COND, scmCond(conditions.join(' ')));
}

export const scmTemplate: Promise<string> = promisify(fs.readFile)(
  path.join(__dirname, 'script.scm'),
  {
    encoding: 'utf-8',
  },
);

export class MissingMemeTemplateError extends Error {
  name = 'MissingMemeTemplateError';
  constructor(public memeTemplate: string) {
    super();
    this.message = `Missing meme template: ${memeTemplate}`;
  }
}

export async function startInkscape(inkscapePath: string) {
  const shell = spawn(inkscapePath, ['--shell']);
  shell.on('error', (e) => {
    throw e;
  });
  shell.stderr.setEncoding('utf-8');
  shell.stdout.setEncoding('utf-8');
  shell.stdin.setDefaultEncoding('utf-8');
  shell.stderr.on('data', (msg) => logger.debug('Inkscape stderr', msg.trim()));
  shell.stdout.on('data', (msg) => logger.debug('Inkscape stdout', msg.trim()));
  shell.on('close', (code) => {
    throw new Error(`Inkscape closed with code ${code}`);
  });
  return shell;
}

export async function getMemes(dir: fs.PathLike): Promise<string[]> {
  return (await promisify(fs.readdir)(dir)).filter(
    (f) => f.endsWith('.svg') || f.endsWith('.xcf'),
  );
}

export async function generateMemeGIMP(
  options: {
    file: string;
    tempOut: string;
    gimpPath: string;
  },
  ...args: string[]
): Promise<Buffer> {
  const script = replaceScript(
    await scmTemplate,
    options.file,
    options.tempOut,
    args.reduce((o, v, i) => {
      o[`$${i + 1}`] = v;
      return o;
    }, {} as Record<string, string>),
  );
  logger.debug(script);

  const childProcess = spawn(options.gimpPath, [
    '-c',
    '--no-interface',
    '-b',
    script,
  ]);
  childProcess.on('error', (e) => {
    throw e;
  });
  childProcess.stderr.setEncoding('utf-8');
  childProcess.stderr.on('data', (msg) => logger.warn('GIMP error', msg));

  await new Promise((res) => {
    childProcess.on('close', (code) => {
      if (code) throw new Error(`GIMP closed with code ${code}`);
      res(code);
    });
  });
  return await promisify(fs.readFile)(options.tempOut);
}

export async function generateMemeInkscape(
  options: {
    file: string;
    tempOut: string;
    shell: Awaited<ReturnType<typeof startInkscape>>;
  },
  ...args: string[]
): Promise<Buffer> {
  const svgCode = await promisify(fs.readFile)(options.file, {
    encoding: 'utf-8',
  });
  const changedSvgCode = args.reduce(
    (svg, value, idx) => svg.replace(`__$${idx + 1}__`, value),
    svgCode,
  );
  await promisify(fs.writeFile)('temp.svg', changedSvgCode, {
    encoding: 'utf-8',
  });

  options.shell.stdin.cork();
  options.shell.stdin.write(
    `file-open:temp.svg; export-type:png; export-filename:${options.tempOut}; export-do; file-close\n`,
  );
  options.shell.stdin.uncork();

  await new Promise<void>((res) => {
    const listener = (msg: string): void => {
      if (msg === '> ') {
        res();
        options.shell.stdout.off('data', listener);
      }
    };
    options.shell.stdout.on('data', listener);
  });
  const buffer = await promisify(fs.readFile)(options.tempOut);
  // promisify(fs.unlink)(options.tempOut);
  return buffer;
}
