import enCommon from './locales/en/common.json';
import enMain from './locales/en/main.json';
import zhHantCommon from './locales/zh-Hant/common.json';
import zhHantMain from './locales/zh-Hant/main.json';
import zhHansSemantic from './locales/zh-Hans/semantic.json';
import { registerMessages } from './registry';

registerMessages('en', enCommon);
registerMessages('en', enMain);
registerMessages('zh-Hant', zhHantCommon);
registerMessages('zh-Hant', zhHantMain);
// 简体中文以原文作 key，只需登记 @ 开头的语义 key。
registerMessages('zh-Hans', zhHansSemantic);
