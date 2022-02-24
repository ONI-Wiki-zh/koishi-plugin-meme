import { spawn } from 'child_process';
import fs from 'fs';
import { Context, Logger, Schema, Time } from 'koishi';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { Flag } from '.';
import Inkscape from './inkscape';

export type ResolvedConfig = {
  gimpPath: string;
  inkscapePath: string;
  imgDir: string;
  tempOut: string;
  minInterval: number;
  authority: {
    upload: number;
    delete: number;
    approve: number;
  };
  listLimit: number;
  pendingLimit: number;
  queueLimit: number;
};
type RecursivePartial<T> = {
  [P in keyof T]?: RecursivePartial<T[P]>;
};
export type Config = RecursivePartial<ResolvedConfig> & Inkscape.Config;
export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    gimpPath: Schema.string()
      .description('GIMP 路径')
      .default(os.platform() === 'win32' ? 'gimp-console-2.10.exe' : 'gimp'),
    imgDir: Schema.string()
      .description('梗图模板文件所在路径')
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
      approve: Schema.number().description('批准模板').default(3),
    })
      .description('控制台权限需求')
      .default({}),
    listLimit: Schema.number()
      .description('显示梗图列表时的最大长度')
      .default(10),
    pendingLimit: Schema.number()
      .description(
        '待审核模板的最大数量，超出后将不允许无审核权限的用户上传新的模板',
      )
      .default(20),
    queueLimit: Schema.number()
      .description('图片生成队列的最大长度')
      .default(5),
  }),
  Inkscape.Config,
]);
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

export async function getMemesPending(ctx: Context): Promise<string[]> {
  const records = ctx.database ? await ctx.database.get('meme', {}) : [];
  return records
    .filter((r) => !(r.flag & Flag.approved))
    .map((r) => r.filename);
}

export async function getMemes(
  dir: fs.PathLike,
  /** use ctx to get approved memes */
  ctx?: Context,
): Promise<string[]> {
  const pendingApprove = ctx ? await getMemesPending(ctx) : [];
  return (await promisify(fs.readdir)(dir)).filter(
    (f) =>
      !pendingApprove.includes(f) && (f.endsWith('.svg') || f.endsWith('.xcf')),
  );
}

export class QueueLengthLimitError extends Error {
  name = 'QueueLengthLimitError';
  constructor(public currentSize: number, public maxSize: number) {
    super();
  }
}

export async function generateMemeGIMP(
  options: {
    /** With extension */
    file: string;
    outPath: string;
    config: ResolvedConfig;
    priority?: number;
  },
  ...args: string[]
): Promise<void> {
  const { queue } = await import('.');
  if (queue.size >= options.config.queueLimit)
    throw new QueueLengthLimitError(queue.size, options.config.queueLimit);
  return await queue.add(
    async () => {
      const script = replaceScript(
        await scmTemplate,
        options.file,
        options.outPath,
        args.reduce((o, v, i) => {
          o[`$${i + 1}`] = v;
          return o;
        }, {} as Record<string, string>),
      );
      logger.debug(script);

      const childProcess = spawn(options.config.gimpPath, [
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
    },
    { priority: options.priority || 0 },
  );
}

export async function generateMemeInkscape(
  options: {
    /** With extension */
    file: string;
    ctx: Context;
    outPath: string;
    config: ResolvedConfig;
    priority?: number;
  },
  ...args: string[]
): Promise<void> {
  const { queue } = await import('.');
  if (queue.size >= options.config.queueLimit)
    throw new QueueLengthLimitError(queue.size, options.config.queueLimit);
  return await queue.add(
    async () => {
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
      await options.ctx.inkscape.svg2png('temp.svg', options.outPath);
    },
    { priority: options.priority || 0 },
  );
}

export function formatList(
  list: string[],
  paging: {
    size: number;
    /** Starting from 0 */
    pageNum: number;
  } = { size: Infinity, pageNum: 0 },
): string {
  let suffix = '';
  if (paging.pageNum < 0 || paging.pageNum % 1) return '页码必须为正整数';
  const maxPage = Math.ceil(list.length / paging.size);
  if (paging.pageNum >= maxPage) return `页码不能超过 ${maxPage}`;
  if (paging.size < list.length) suffix += `\n... 共 ${list.length} 条结果`;

  const offset = paging.size * paging.pageNum || 0;
  return (
    list
      .slice(offset, offset + paging.size)
      .map((n, i) => `${i + offset + 1}. ${n}`)
      .join('\n') + suffix
  );
}
