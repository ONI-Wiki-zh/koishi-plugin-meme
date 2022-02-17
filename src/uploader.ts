import { DataService } from '@koishijs/plugin-console';
import fs from 'fs';
import { Context } from 'koishi';
import path, { resolve } from 'path';
import { promisify } from 'util';
import { getMemes, ResolvedConfig } from './utils';

declare module '@koishijs/plugin-console' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Console {
    interface Services {
      memes: MemesProvider;
    }
  }

  interface Events {
    ['meme/refresh'](): void;
    ['meme/upload'](name: string, file: string): Promise<void>;
    ['meme/delete'](name: string): Promise<void>;
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

    ctx.console.addListener('meme/upload', async (name, file) => {
      await promisify(fs.writeFile)(
        path.join(config.imgDir, `${name}.xcf`),
        file.replace(/^data:.+?;base64,/, ''),
        'base64',
      );
      this.refresh();
    });
    ctx.console.addListener('meme/delete', async (name) => {
      await promisify(fs.unlink)(path.join(config.imgDir, `${name}.xcf`));
      this.refresh();
    });
    ctx.console.addListener('meme/refresh', () => this.refresh());
  }

  async getInfo(): Promise<string[]> {
    return (await getMemes(this.config.imgDir)).filter((n) =>
      n.endsWith('.xcf'),
    );
  }

  get(forced = false): Promise<string[]> {
    if (forced) delete this.task;
    return (this.task ||= this.getInfo());
  }
}
