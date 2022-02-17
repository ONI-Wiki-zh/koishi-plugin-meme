import {} from '@koishijs/plugin-rate-limit';
import { Context, segment } from 'koishi';
import { lookpath } from 'lookpath';
import MemesProvider from './uploader';
import {
  generateMeme,
  getMemes,
  MissingMemeTemplateError,
  ResolvedConfig,
} from './utils';

export { Config } from './utils';
export const name = 'meme';
export async function apply(
  ctx: Context,
  config: ResolvedConfig,
): Promise<void> {
  const logger = ctx.logger('meme');
  try {
    const gimpPath = await lookpath(config.gimpCommand, {});
    logger.info(`GIMP location: ${gimpPath}`);
  } catch (e) {
    throw new Error(`Can not find GIMP using ${config.gimpCommand}`);
  }

  ctx.using(['console'], (ctx) => ctx.plugin(MemesProvider, config));

  ctx
    .command('meme <img:string> [...args:string]', '生成梗图', {
      minInterval: config.minInterval,
    })
    .usage(
      `请使用梗图模板名称与插值字符串生成梗图。例如：meme ${
        (await getMemes(config.imgDir))
          .find((s) => s.endsWith('.xcf'))
          ?.slice(0, -4) ?? '模板名'
      } 文字1 文字2`,
    )
    .action(async ({ session }, img, ...args) => {
      if (!session) throw new Error('No session.');
      if (!img) return session?.execute('help meme');
      try {
        return segment.image(
          await generateMeme(
            {
              name: img,
              imgDir: config.imgDir,
              tempOut: config.tempOut,
              gimpCommand: config.gimpCommand,
            },
            ...args,
          ),
        );
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
      .filter((f) => f.endsWith('.xcf'))
      .map((f, i) => `${i + 1}. ${f.slice(0, -4)}`)
      .slice(0, 20)
      .join('\n');
  });
}

export * from './uploader';
export * from './utils';
