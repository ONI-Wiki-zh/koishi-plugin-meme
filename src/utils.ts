import { spawn } from 'child_process';
import fs from 'fs';
import { Logger, Schema, Time } from 'koishi';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

export type ResolvedConfig = {
  gimpCommand: string;
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
  gimpCommand: Schema.string()
    .description('GIMP 命令')
    .default(os.platform() === 'win32' ? 'gimp-console-2.10.exe' : 'gimp'),
  imgDir: Schema.string()
    .description('xcf 图片所在文件夹路径')
    .default('memes'),
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

export function getMemes(dir: fs.PathLike): Promise<string[]> {
  return promisify(fs.readdir)(dir);
}

export async function generateMeme(
  options: {
    name: string;
    imgDir: string;
    tempOut: string;
    gimpCommand: string;
  },
  ...args: string[]
): Promise<Buffer> {
  const imagePath = path.join(options.imgDir, `${options.name}.xcf`);
  if (!fs.existsSync(imagePath)) throw new MissingMemeTemplateError(imagePath);
  const script = replaceScript(
    await scmTemplate,
    imagePath,
    options.tempOut,
    args.reduce((o, v, i) => {
      o[`$${i + 1}`] = v;
      return o;
    }, {} as Record<string, string>),
  );
  logger.debug(script);

  const childProcess = spawn(options.gimpCommand, [
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
