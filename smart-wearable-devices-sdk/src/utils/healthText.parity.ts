import { isLikelyMojibakeHealthText, normalizeHealthLevel, normalizeHealthText } from './healthText';

const fromCodePoints = (...values: number[]) => String.fromCodePoint(...values);
const rwMojibakeText = {
  notCharging: fromCodePoints(0x93c8, 0xe044, 0x5396, 0x9422, 0x3f),
  deviceNoRealtimeValue: fromCodePoints(0x7481, 0x60e7, 0xe62c, 0x93c8, 0xe047, 0x7e51, 0x9365, 0x70b2, 0x7584, 0x93c3, 0x8235, 0x669f, 0x934a, 0x3f),
  requestedAndWaiting: fromCodePoints(
    0x5bb8,
    0x8336,
    0xe1ec,
    0x59f9,
    0x509d,
    0xe505,
    0x59d8,
    0x044d,
    0x7d1d,
    0x7edb,
    0x590a,
    0x7ddf,
    0x7481,
    0x60e7,
    0xe62c,
    0x6d93,
    0x5a43,
    0x59e4
  ),
  timeout: fromCodePoints(0x74d2, 0x546e, 0x6902)
};

const cases: Array<[unknown, string, string?]> = [
  ['Needs improvement', '\u5f85\u6539\u5584'],
  ['Good', '\u826f\u597d'],
  ['Excellent', '\u4f18\u79c0'],
  ['No change', '\u57fa\u672c\u6301\u5e73'],
  ['increased', '\u4e0a\u5347'],
  ['decreased', '\u4e0b\u964d'],
  ['unsupported_realtime', '\u5f53\u524d\u8bbe\u5907\u6682\u4e0d\u652f\u6301\u5b9e\u65f6\u8bfb\u53d6'],
  ['sleep ok', '\u7761\u7720\u6b63\u5e38'],
  ['Lifestyle', '\u751f\u6d3b\u4e60\u60ef'],
  ['Sleep activation', '\u7761\u7720\u6fc0\u6d3b'],
  ['Activity risk', '\u6d3b\u52a8\u5f3a\u5ea6'],
  ['Room for improvement', '\u5f85\u6539\u5584'],
  ['Low activity', '\u6d3b\u52a8\u504f\u4f4e'],
  ['Exercise regularity', '\u8fd0\u52a8\u89c4\u5f8b\u6027'],
  ['Vital signs', '\u751f\u547d\u4f53\u5f81'],
  ['Blood oxygen', '\u8840\u6c27'],
  ['Deep sleep', '\u6df1\u7761'],
  ['Heavy load', '\u91cd\u5ea6\u8d1f\u8377'],
  ['心脉介绍', '心脉介绍'],
  ['生活习惯评分', '生活习惯评分'],
  ['2.2.9', '2.2.9'],
  ['2026-07-13', '2026-07-13'],
  [fromCodePoints(0x95bc, 0x3f, 0x9288, 0x3f), '--'],
  [rwMojibakeText.notCharging, '\u672a\u5145\u7535'],
  [rwMojibakeText.deviceNoRealtimeValue, '\u8bbe\u5907\u672a\u8fd4\u56de\u5b9e\u65f6\u6570\u503c'],
  [rwMojibakeText.requestedAndWaiting, '--'],
  [rwMojibakeText.timeout, '\u8bbe\u5907\u54cd\u5e94\u8d85\u65f6'],
  ['requested', '-', '-'],
  ['pending', '-', '-'],
  ['waiting', '-', '-'],
  ['', '\u6682\u65e0', '\u6682\u65e0']
];

for (const [input, expected, fallback] of cases) {
  const actual = normalizeHealthText(input, fallback);
  if (actual !== expected) {
    throw new Error(`normalizeHealthText(${JSON.stringify(input)}) should be ${expected}, got ${actual}`);
  }
}

if (
  normalizeHealthLevel('', 81) !== '\u4f18\u79c0' ||
  normalizeHealthLevel('', 65) !== '\u826f\u597d' ||
  normalizeHealthLevel('', 20) !== '\u5f85\u6539\u5584'
) {
  throw new Error('normalizeHealthLevel should derive a Chinese level from score when text is empty.');
}

if (
  !isLikelyMojibakeHealthText(fromCodePoints(0x95bc, 0x3f, 0x9288, 0x3f)) ||
  isLikelyMojibakeHealthText('\u826f\u597d') ||
  isLikelyMojibakeHealthText('心脉介绍')
) {
  throw new Error('Mojibake detector should catch malformed health text without flagging normal Chinese.');
}
