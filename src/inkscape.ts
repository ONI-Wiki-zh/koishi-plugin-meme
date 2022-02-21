import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { Logger, Schema } from 'koishi';
import { Context, Service } from 'koishi';
import os from 'os';

declare module 'koishi' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Context {
    interface Services {
      inkscape: Inkscape;
    }
  }
}

class Inkscape extends Service {
  shell: ChildProcessWithoutNullStreams;
  logger: Logger;

  constructor(ctx: Context, public config: Inkscape.ResolvedConfig) {
    super(ctx, 'inkscape', true);
    this.logger = ctx.logger('inkscape');
    this.shell = spawn(this.config.inkscapePath, ['--shell']);
    this.shell.on('error', (e) => {
      throw e;
    });
    this.shell.stderr.setEncoding('utf-8');
    this.shell.stdout.setEncoding('utf-8');
    this.shell.stdin.setDefaultEncoding('utf-8');
    this.shell.stderr.on('data', (msg) =>
      this.logger.debug('Inkscape stderr', msg.trim()),
    );
    this.shell.stdout.on('data', (msg) =>
      this.logger.debug('Inkscape stdout', msg.trim()),
    );
    this.shell.on('close', (code) => {
      throw new Error(`Inkscape closed with code ${code}`);
    });
  }

  async stop(): Promise<void> {
    this.shell.stdin.cork();
    this.shell.stdin.write('quit\n');
    this.shell.stdin.uncork();
    await new Promise<void>((res) => {
      this.shell.once('close', () => res());
    });
  }

  async command(cmd: string): Promise<void> {
    this.shell.stdin.cork();
    this.shell.stdin.write(cmd);
    this.shell.stdin.uncork();

    await new Promise<void>((res) => {
      const listener = (msg: string): void => {
        if (msg === '> ') {
          res();
          this.shell.stdout.off('data', listener);
        }
      };
      this.shell.stdout.on('data', listener);
    });
  }

  svg2png(svg: string, png: string): Promise<void> {
    return this.command(
      `file-open:${svg}; export-type:png; export-filename:${png}; export-do; file-close\n`,
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace Inkscape {
  export interface ResolvedConfig {
    inkscapePath: string;
  }
  export type Config = Partial<ResolvedConfig>;
  export const Config: Schema<Config> = Schema.object({
    inkscapePath: Schema.string()
      .description('inkscape 路径')
      .default(os.platform() === 'win32' ? 'inkscape.com' : 'inkscape'),
  });
}

export default Inkscape;
