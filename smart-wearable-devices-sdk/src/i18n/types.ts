export type AppLocale = 'zh-Hans' | 'zh-Hant' | 'en';

export type LocaleMode = 'system' | AppLocale;

export type MessageParams = Record<string, string | number | boolean | null | undefined>;

export interface PluralMessage {
  one?: string;
  other: string;
}

export type MessageValue = string | PluralMessage;

export type MessageDict = Record<string, MessageValue>;
