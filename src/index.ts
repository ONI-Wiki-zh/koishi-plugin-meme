import {} from '@koishijs/plugin-rate-limit';
import fs from 'fs';
import { Context, segment } from 'koishi';
import { lookpath } from 'lookpath';
import PQueue from 'p-queue';
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
  QueueLengthLimitError,
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
      /** User.id */
      author?: string;
    };
  }
  interface EventMap {
    /** Emitted when some memes are approved/unapproved */
    'memes/approve'(
      /** approved memes with file ext */
      memes: string[],
    ): void;
  }
}

export let queue: PQueue;

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
    queue = new PQueue({ concurrency: 1 });
  });

  ctx.on('dispose', () => {
    queue.clear();
  });

  ctx.using(['console'], (ctx) => ctx.plugin(MemesProvider, config));
  ctx.using(['database'], (ctx) => {
    ctx.model.extend(
      'meme',
      {
        filename: 'string',
        author: 'string',
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
    .command('meme <img:string> [...args:string]', '????????????', {
      minInterval: config.minInterval,
    })
    .option('gimp', '-g ?????? GIMP ????????????')
    .option('inkscape', '-i ?????? inkscape ????????????')
    .usage(
      `?????????????????????????????????????????????????????????????????????meme ${
        (await getMemes(config.imgDir))[0]?.slice(0, -4) ?? '?????????'
      } ??????1 ??????2`,
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
              config,
              priority: 2,
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
              config,
              priority: 2,
            },
            ...args,
          );
        else if (pending.includes(filenameXcf))
          return `???????????? ${filenameXcf} ???????????????`;
        else if (pending.includes(filenameSvg))
          return `???????????? ${filenameSvg} ???????????????`;
        else throw new MissingMemeTemplateError(img);

        return segment.image(await promisify(fs.readFile)(config.tempOut));
      } catch (e) {
        if (e instanceof MissingMemeTemplateError)
          return `????????????????????? ${e.memeTemplate}`;
        else if (e instanceof QueueLengthLimitError)
          return `??????????????????????????????`;
        else {
          logger.warn(e);
          return '??????????????????';
        }
      }
    });

  ctx
    .command('meme.list', '??????????????????')
    .option('page', '-p <page> ????????????')
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
      .command('meme.approve <template:string>', '????????????????????????', {
        authority: config.authority.approve,
      })
      .option('list', '-l ?????????????????????')
      .option('page', '-p <page> ????????????')
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
        if (!record) return `?????? ${template} ?????????`;
        const newFlag = record.flag ^ Flag.approved;

        await ctx.database.set(
          'meme',
          { filename: template },
          { flag: newFlag },
        );
        ctx.emit('memes/approve', [template]);
        return `?????? ${template} ???????????? ???${
          newFlag & Flag.approved ? '?????????' : '?????????'
        }???`;
      });
  });
}
