import {} from '@koishijs/plugin-auth';
import { DataService } from '@koishijs/plugin-console';
import fs, { createReadStream } from 'fs';
import { Context, Logger } from 'koishi';
import path, { extname, resolve } from 'path';
import { promisify } from 'util';
import { Flag, generateMemeGIMP, generateMemeInkscape } from '.';
import { getMemes, ResolvedConfig } from './utils';

const logger = new Logger('meme');

declare module '@koishijs/plugin-console' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Console {
    interface Services {
      memes: MemesProvider;
    }
  }

  interface Events {
    ['meme/refresh'](): void;
    ['meme/upload'](
      this: SocketHandle,
      name: string,
      file: string,
    ): Promise<void>;
    ['meme/delete'](
      this: SocketHandle,
      name: string,
      refresh?: boolean,
    ): Promise<void>;
  }
}

export default class MemesProvider extends DataService<string[]> {
  static using = ['console'] as const;
  private task?: Promise<string[]>;

  constructor(ctx: Context, private config: ResolvedConfig) {
    super(ctx, 'memes');

    ctx.console.addEntry({
      dev: resolve(__dirname, '../client/index.ts'),
      prod: resolve(__dirname, '../dist'),
    });

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const memesProvider: MemesProvider = this;

    ctx.console.addListener(
      'meme/upload',
      async function (name, file) {
        const filePath = path.join(config.imgDir, name);
        if (fs.existsSync(filePath))
          throw new Error(`File ${filePath} already exist`);
        await promisify(fs.writeFile)(
          filePath,
          file.replace(/^data:.+?;base64,/, ''),
          'base64',
        );

        if (ctx.database) {
          let flag = 0;
          if (
            this.user?.authority &&
            this.user.authority >= config.authority.approve
          )
            flag |= Flag.approved;
          await ctx.database.upsert('meme', [
            {
              filename: name,
              author: this.user?.id && parseInt(this.user.id),
              flag,
            },
          ]);
        }
        memesProvider.refresh();
      },
      { authority: config.authority.upload },
    );

    ctx.console.addListener(
      'meme/delete',
      async function (name, refresh = true) {
        const filePath = path.join(config.imgDir, name);
        await promisify(fs.unlink)(filePath);
        if (fs.existsSync(`${filePath}.png`)) {
          await promisify(fs.unlink)(`${filePath}.png`);
        }
        if (ctx.database) {
          await ctx.database.remove('meme', {
            filename: filePath,
          });
        }

        if (refresh) memesProvider.refresh();
      },
      { authority: config.authority.delete },
    );
    ctx.console.addListener('meme/refresh', () => this.refresh());

    // preview images
    const kCtx = ctx;
    ctx.router.get(
      ctx.console.global.uiPath + '/meme/files/(.+)',
      async (ctx, next) => {
        try {
          const file = decodeURI(ctx.URL.pathname.split('/')[3]);
          const filePath = path.join(config.imgDir, file);
          if (filePath.endsWith('.png') && !fs.existsSync(filePath)) {
            const original = filePath.slice(0, -4);
            if (original.endsWith('.svg'))
              await generateMemeInkscape({
                ctx: kCtx,
                file: original,
                outPath: filePath,
              });
            else if (original.endsWith('.xcf'))
              await generateMemeGIMP({
                file: original,
                outPath: filePath,
                gimpPath: config.gimpPath,
              });
          }

          ctx.type = extname(filePath);
          ctx.body = createReadStream(filePath);
          return;
        } catch (e) {
          logger.warn(e);
          await next();
        }
      },
    );
  }

  getInfo(): Promise<string[]> {
    return getMemes(this.config.imgDir);
  }

  get(forced = false): Promise<string[]> {
    if (forced) delete this.task;
    this.task ||= this.getInfo();
    return this.task;
  }
}
