// healths 分包语言包：只能由 pagesA/healths 下的页面副作用引入。
import en from './locales/en.json';
import zhHant from './locales/zh-Hant.json';
import { registerMessages } from '@/i18n/registry';

registerMessages('en', en);
registerMessages('zh-Hant', zhHant);
