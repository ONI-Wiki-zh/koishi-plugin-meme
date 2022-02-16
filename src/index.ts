import { spawn } from 'child_process';
import fs from 'fs';
import { Context, Schema, segment, Time } from 'koishi';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import {} from '@koishijs/plugin-rate-limit';
import { lookpath } from 'lookpath';

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

type ResolvedConfig = {
  gimpCommand: string;
  imgDir: string;
  tempOut: string;
};

export type Config = Partial<ResolvedConfig>;
export const Config = Schema.object({
  gimpCommand: Schema.string()
    .description('GIMP 命令')
    .default(os.platform() === 'win32' ? 'gimp-console-2.10.exe' : 'gimp'),
  imgDir: Schema.string()
    .description('xcf 图片所在文件夹路径')
    .default('memes'),
  tempOut: Schema.string()
    .description('生成的临时图片所在的路径')
    .default('temp.png'),
});

export const name = 'gimp';
export async function apply(
  ctx: Context,
  config: ResolvedConfig,
): Promise<void> {
  const logger = ctx.logger('gimp');
  try {
    const gimpPath = await lookpath(config.gimpCommand, {});
    logger.info(`GIMP location: ${gimpPath}`);
  } catch (e) {
    throw new Error(`Can not find GIMP using ${config.gimpCommand}`);
  }

  const scmTemplate: string = await new Promise<string>((res) => {
    fs.readFile(
      path.join(__dirname, 'script.scm'),
      {
        encoding: 'utf-8',
      },
      (_, code) => res(code),
    );
  });

  ctx
    .command('meme <img:string> [...args:string]', '生成梗图', {
      minInterval: Time.minute,
    })
    .action(async ({ session }, img, ...args) => {
      if (!session) throw new Error('No session.');
      const imagePath = path.join(config.imgDir, `${img}.xcf`);
      if (!fs.existsSync(imagePath)) return `不存在梗图模板 ${img}`;
      const script = replaceScript(
        scmTemplate,
        imagePath,
        config.tempOut,
        args.reduce((o, v, i) => {
          o[`$${i + 1}`] = v;
          return o;
        }, {} as Record<string, string>),
      );
      logger.info(script);
      try {
        const childProcess = spawn(config.gimpCommand, [
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
        return segment.image(await promisify(fs.readFile)(config.tempOut));
      } catch (e) {
        logger.warn(e);
        return '出了亿点问题';
      }
    });

  ctx.command('meme.list', '列出梗图模板').action(async ({ session }) => {
    const list = await promisify(fs.readdir)(config.imgDir);
    return list
      .filter((f) => f.endsWith('.xcf'))
      .map((f, i) => `${i + 1}. ${f.slice(0, -4)}`)
      .slice(0, 20)
      .join('\n');
  });
}
