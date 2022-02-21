import {} from '@koishijs/plugin-rate-limit';
import fs from 'fs';
import { Context, segment } from 'koishi';
import { lookpath } from 'lookpath';
import path from 'path';
import { promisify } from 'util';
import Inkscape from './inkscape';
import MemesProvider from './uploader';
import {
  formatList,
  generateMemeGIMP,
  generateMemeInkscape,
  getMemes,
  getMemesPending,
  MissingMemeTemplateError,
  ResolvedConfig,
} from './utils';

export * from './uploader';
export * from './utils';
export { Config } from './utils';

export enum Flag {
  approved = 1,
}

declare module 'koishi' {
  interface Tables {
    meme: {
      filename: string;
      flag: number;
      author?: number;
    };
  }
}

export const name = 'meme';
export async function apply(
  ctx: Context,
  config: ResolvedConfig,
): Promise<void> {
  const logger = ctx.logger('meme');
  ctx.on('ready', async () => {
    const gimpPath = await lookpath(config.gimpPath, {});
    if (gimpPath) logger.info(`GIMP location: ${gimpPath}`);
    else logger.error(`Can not find GIMP with ${config.gimpPath}`);

    try {
      const inkscapePath = await lookpath(config.inkscapePath, {});
      if (inkscapePath) {
        logger.info(`Inkscape location: ${inkscapePath}`);
        ctx.plugin(Inkscape, config);
      } else logger.error(`Can not find Inkscape with ${config.inkscapePath}`);
    } catch (e) {
      throw new Error(`Inkscape init error`);
    }
  });

  ctx.using(['console'], (ctx) => ctx.plugin(MemesProvider, config));
  ctx.using(['database'], (ctx) => {
    ctx.model.extend(
      'meme',
      {
        filename: 'string',
        author: 'unsigned',
        flag: {
          type: 'unsigned',
          initial: 0,
        },
      },
      {
        primary: 'filename',
      },
    );
  });

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
        const pending = await getMemesPending(ctx);
        const filenameXcf = `${img}.xcf`;
        const filenameSvg = `${img}.svg`;
        const imagePathXcf = path.join(config.imgDir, filenameXcf);
        const imagePathSvg = path.join(config.imgDir, filenameSvg);
        if (
          !pending.includes(filenameSvg) &&
          fs.existsSync(imagePathSvg) &&
          !options?.gimp
        ) {
          if (!ctx.inkscape && fs.existsSync(imagePathXcf))
            throw new Error('No inkscape shell');
          await generateMemeInkscape(
            {
              ctx,
              file: imagePathSvg,
              outPath: config.tempOut,
            },
            ...args,
          );
        } else if (
          !pending.includes(filenameXcf) &&
          fs.existsSync(imagePathXcf) &&
          !options?.inkscape
        )
          await generateMemeGIMP(
            {
              file: imagePathXcf,
              outPath: config.tempOut,
              gimpPath: config.gimpPath,
            },
            ...args,
          );
        else if (pending.includes(filenameXcf))
          return `梗图模板 ${filenameXcf} 正在审核中`;
        else if (pending.includes(filenameSvg))
          return `梗图模板 ${filenameSvg} 正在审核中`;
        else throw new MissingMemeTemplateError(img);

        return segment.image(await promisify(fs.readFile)(config.tempOut));
      } catch (e) {
        if (e instanceof MissingMemeTemplateError)
          return `不存在梗图模板 ${e.memeTemplate}`;
        else {
          logger.warn(e);
          return '出了亿点问题';
        }
      }
    });

  ctx
    .command('meme.list', '列出梗图模板')
    .option('page', '-p <page> 指定页码')
    .action(async ({ options }) => {
      const names = (await getMemes(config.imgDir, ctx)).map((n) =>
        n.slice(0, -4),
      );
      return formatList([...new Set(names)].sort(), {
        size: config.listLimit,
        pageNum: options?.page - 1 || 0,
      });
    });

  ctx.using(['database'], (ctx) => {
    ctx
      .command('meme.approve <template:string>', '梗图模板审核工具', {
        authority: config.authority.approve,
      })
      .option('list', '-l 列出待审核模板')
      .option('page', '-p <page> 指定页码')
      .action(async ({ options, session }, template) => {
        if (options?.list)
          return formatList(await getMemesPending(ctx), {
            size: config.listLimit,
            pageNum: options.page - 1 || 0,
          });
        if (!template) return session?.execute('help meme.approve');
        const record = (
          await ctx.database.get('meme', {
            filename: template,
          })
        )?.[0];
        if (!record) return `模板 ${template} 不存在`;
        const newFlag = record.flag ^ Flag.approved;

        await ctx.database.set(
          'meme',
          { filename: template },
          { flag: newFlag },
        );
        return `模板 ${template} 已修改为 “${
          newFlag & Flag.approved ? '已审核' : '待审核'
        }”`;
      });
  });
}
