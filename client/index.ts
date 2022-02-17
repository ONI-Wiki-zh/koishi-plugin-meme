import { Context } from '@koishijs/client';
import {} from 'koishi-plugin-meme';
import Page from './meme.vue';

export default (ctx: Context): void => {
  ctx.addPage({
    name: '梗图生成器',
    path: '/meme',
    component: Page,
    authority: 1,
  });
};
