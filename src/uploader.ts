import { UserAuth } from '@koishijs/plugin-auth';
import { DataService } from '@koishijs/plugin-console';
import fs, { createReadStream } from 'fs';
import koaBody from 'koa-body';
import { Context, Logger } from 'koishi';
import path, { extname, resolve } from 'path';
import { promisify } from 'util';
import { Flag, generateMemeGIMP, generateMemeInkscape } from '.';
import { getMemes, ResolvedConfig } from './utils';
import { Response } from 'koa';

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
    ['meme/delete'](
      this: SocketHandle,
      name: string,
      refresh?: boolean,
    ): Promise<void>;
    ['meme/preview'](
      this: SocketHandle,
      name: string,
      args: string[],
    ): Promise<string>;
    ['meme/approve'](this: SocketHandle, name: string): Promise<void>;
  }
}
export type MemesData = {
  allMemes: string[];
  approvedMemes: string[];
};

export default class MemesProvider extends DataService<MemesData> {
  static using = ['console'] as const;
  private task?: Promise<MemesData>;

  constructor(ctx: Context, private config: ResolvedConfig) {
    super(ctx, 'memes');

    ctx.console.addEntry({
      dev: resolve(__dirname, '../client/index.ts'),
      prod: resolve(__dirname, '../dist'),
    });

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const memesProvider: MemesProvider = this;

    ctx.console.addListener(
      'meme/delete',
      async function (name, refresh = true) {
        let ownUpload = false;
        if (ctx.database && this.user) {
          const [record] = await ctx.database.get('meme', {
            filename: name,
          });
          if (record?.author && record.author === this.user.id)
            ownUpload = true;
        }
        if (
          this.user &&
          !ownUpload &&
          this.user.authority < config.authority.approve
        )
          throw new Error('Not authorized');

        const filePath = path.join(config.imgDir, name);
        await promisify(fs.unlink)(filePath);
        if (fs.existsSync(`${filePath}.png`)) {
          await promisify(fs.unlink)(`${filePath}.png`);
        }

        if (ctx.database) {
          await ctx.database.remove('meme', {
            filename: name,
          });
        }

        if (refresh) memesProvider.refresh();
      },
      { authority: 1 },
    );

    ctx.console.addListener('meme/refresh', () => this.refresh());

    ctx.using(['database'], (ctx) => {
      ctx.console.addListener(
        'meme/approve',
        async (template) => {
          const [record] = await ctx.database.get('meme', {
            filename: template,
          });
          if (!record)
            if ((await getMemes(config.imgDir)).includes(template))
              await ctx.database.create('meme', {
                filename: template,
                flag: 0 & Flag.approved,
              });
            else throw new Error(`模板 ${template} 不存在`);
          const newFlag = record.flag ^ Flag.approved;

          await ctx.database.set(
            'meme',
            { filename: template },
            { flag: newFlag },
          );
          ctx.emit('memes/approve', [template]);
          logger.info(
            `模板 ${template} 已修改为 “${
              newFlag & Flag.approved ? '已审核' : '待审核'
            }”`,
          );
        },
        {
          authority: config.authority.approve,
        },
      );
    });

    ctx.console.addListener('meme/preview', async (name, args) => {
      const templatePath = path.join(config.imgDir, name);
      if (name.endsWith('xcf')) {
        await generateMemeGIMP(
          {
            file: templatePath,
            outPath: config.tempOut,
            config,
          },
          ...args,
        );
      } else if (name.endsWith('svg')) {
        await generateMemeInkscape(
          {
            ctx,
            file: templatePath,
            outPath: config.tempOut,
            config,
          },
          ...args,
        );
      } else {
        throw new Error('Expect an xcf or svg file');
      }
      return await promisify(fs.readFile)(config.tempOut, {
        encoding: 'base64',
      });
    });

    ctx.on('memes/approve', () => this.refresh());

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
                config,
                priority: 1,
              });
            else if (original.endsWith('.xcf'))
              await generateMemeGIMP({
                file: original,
                outPath: filePath,
                config,
                priority: 1,
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

    ctx.router.use(
      koaBody({
        multipart: true,
        formidable: { maxFileSize: 10 * 1024 * 1024 },
      }),
    );
    ctx.router.post(
      ctx.console.global.uiPath + '/meme/files',
      async (ctx, next) => {
        try {
          const res = ctx.response;
          // Check file format
          const file = ctx.request.files?.file;
          if (Array.isArray(file) || !file?.name)
            return koaResponse(res, 400, 'Missing or multiple files');
          if (!file.name.endsWith('svg') && !file.name.endsWith('xcf'))
            return koaResponse(res, 400, 'File type must be svg or xcf');

          // Check user
          let user;
          if (kCtx.database) {
            const userRaw = ctx.request.body.user;
            const userAuth: UserAuth =
              typeof userRaw === 'string' && userRaw && JSON.parse(userRaw);
            if (!userAuth?.id) return koaResponse(res, 401, 'No user');

            user = await kCtx.database.getUser('id', userAuth.id);
            if (!user) return koaResponse(res, 401, 'User not exist');

            if (user.token !== userAuth.token || user.expire <= Date.now())
              return koaResponse(res, 401, 'Invalid token');

            // Update privilege checking
            if (user.authority < config.authority.upload)
              return koaResponse(res, 401, 'Not authorized');

            // Limit the number of pending memes
            if (user.authority < config.authority.approve) {
              const pendingMemes = await kCtx.database.get(
                'meme',
                {
                  flag: {
                    $bitsAllClear: Flag.approved,
                  },
                },
                {
                  limit: config.pendingLimit,
                },
              );
              if (pendingMemes.length >= config.pendingLimit)
                return koaResponse(res, 503, 'Too many pending memes');
            }
          }

          const filePath = path.join(config.imgDir, file.name);
          if (fs.existsSync(filePath))
            return koaResponse(res, 400, `File ${file.name} already exist`);

          const reader = fs.createReadStream(file.path);
          const stream = fs.createWriteStream(filePath);
          reader.pipe(stream);
          await new Promise<void>((res) => reader.once('close', () => res()));

          // Insert record to the database
          if (kCtx.database && user) {
            let flag = 0;
            if (user.authority >= config.authority.approve)
              flag |= Flag.approved;
            await kCtx.database.upsert('meme', [
              {
                filename: file.name,
                author: user?.id && parseInt(user.id),
                flag,
              },
            ]);
          }
          memesProvider.refresh();
          ctx.status = 201;
          return;
        } catch (e) {
          logger.warn(e);
          await next();
        }
      },
    );
  }

  async getInfo(): Promise<MemesData> {
    return {
      allMemes: await getMemes(this.config.imgDir),
      approvedMemes: await getMemes(this.config.imgDir, this.ctx),
    };
  }

  get(forced = false): Promise<MemesData> {
    if (forced) delete this.task;
    this.task ||= this.getInfo();
    return this.task;
  }
}

export function koaResponse(res: Response, code: number, body: unknown): void {
  res.status = code;
  res.body = body;
}
