import {} from '@koishijs/plugin-rate-limit';
import fs from 'fs';
import { Context, segment } from 'koishi';
import { lookpath } from 'lookpath';
import path from 'path';
import MemesProvider from './uploader';
import {
  generateMemeGIMP,
  generateMemeInkscape,
  getMemes,
  MissingMemeTemplateError,
  ResolvedConfig,
  startInkscape,
} from './utils';

export * from './uploader';
export * from './utils';
export { Config } from './utils';
export const name = 'meme';
export async function apply(
  ctx: Context,
  config: ResolvedConfig,
): Promise<void> {
  const logger = ctx.logger('meme');
  let inkscapeShell: Awaited<ReturnType<typeof startInkscape>>;
  ctx.on('ready', async () => {
    const gimpPath = await lookpath(config.gimpPath, {});
    if (gimpPath) logger.info(`GIMP location: ${gimpPath}`);
    else logger.error(`Can not find GIMP with ${config.gimpPath}`);

    try {
      const inkscapePath = await lookpath(config.inkscapePath, {});
      if (inkscapePath) {
        logger.info(`Inkscape location: ${inkscapePath}`);
        inkscapeShell = await startInkscape(config.inkscapePath);
      } else logger.error(`Can not find Inkscape with ${config.inkscapePath}`);
    } catch (e) {
      throw new Error(`Inkscape init error`);
    }
  });
  ctx.on('dispose', async () => {
    if (!inkscapeShell) return;
    inkscapeShell.stdin.cork();
    inkscapeShell.stdin.write('quit\n');
    inkscapeShell.stdin.uncork();
    await new Promise<void>((res) => {
      inkscapeShell.once('close', () => res());
    });
  });

  ctx.using(['console'], (ctx) => ctx.plugin(MemesProvider, config));

  ctx
    .command('meme <img:string> [...args:string]', '生成梗图', {
      minInterval: config.minInterval,
    })
    .option('gimp', '-g 使用 GIMP 生成梗图')
    .option('inkscape', '-i 使用 inkscape 生成梗图')
    .usage(
      `请使用梗图模板名称与插值字符串生成梗图。例如：meme ${
        (await getMemes(config.imgDir))[0]?.slice(0, -4) ?? '模板名'
      } 文字1 文字2`,
    )
    .action(async ({ session, options }, img, ...args) => {
      if (!session) throw new Error('No session.');
      if (!img) return session?.execute('help meme');
      try {
        const imagePathXcf = path.join(config.imgDir, `${img}.xcf`);
        const imagePathSvg = path.join(config.imgDir, `${img}.svg`);
        let generated: Buffer;
        if (fs.existsSync(imagePathSvg) && !options?.gimp) {
          if (!inkscapeShell && fs.existsSync(imagePathXcf))
            throw new Error('No inkscape shell');
          generated = await generateMemeInkscape(
            {
              shell: inkscapeShell,
              file: imagePathSvg,
              tempOut: config.tempOut,
            },
            ...args,
          );
        } else if (fs.existsSync(imagePathXcf) && !options?.inkscape)
          generated = await generateMemeGIMP(
            {
              file: imagePathXcf,
              tempOut: config.tempOut,
              gimpPath: config.gimpPath,
            },
            ...args,
          );
        else throw new MissingMemeTemplateError(img);

        return segment.image(generated);
      } catch (e) {
        if (e instanceof MissingMemeTemplateError)
          return `不存在梗图模板 ${e.memeTemplate}`;
        else {
          logger.warn(e);
          return '出了亿点问题';
        }
      }
    });

  ctx.command('meme.list', '列出梗图模板').action(async () => {
    return (await getMemes(config.imgDir))
      .map((f, i) => `${i + 1}. ${f.slice(0, -4)}`)
      .slice(0, 20)
      .join('\n');
  });
}
