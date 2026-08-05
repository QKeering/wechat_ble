export type PeriodPhaseKey = 'menstrual' | 'ovulation' | 'fertile' | 'safe';

export interface PeriodPhaseSegment {
  start?: string;
  end?: string;
  [key: string]: unknown;
}

export interface PeriodPhaseCycle {
  menstrual?: PeriodPhaseSegment;
  menstruation?: PeriodPhaseSegment;
  period?: PeriodPhaseSegment;
  ovulation?: PeriodPhaseSegment;
  fertility?: PeriodPhaseSegment;
  fertile?: PeriodPhaseSegment;
  follicular?: PeriodPhaseSegment;
  safe?: PeriodPhaseSegment;
  luteal?: PeriodPhaseSegment;
  [key: string]: unknown;
}

export const PERIOD_PHASE_INDEX: Record<PeriodPhaseKey, number> = {
  menstrual: 0,
  ovulation: 1,
  fertile: 2,
  safe: 3
};

export const PERIOD_PHASE_LABEL: Record<PeriodPhaseKey, string> = {
  menstrual: '月经期',
  ovulation: '排卵期',
  fertile: '易孕期',
  safe: '安全期'
};

export const PERIOD_PHASE_ICON: Record<PeriodPhaseKey, string> = {
  menstrual: 'M',
  ovulation: 'O',
  fertile: 'F',
  safe: 'S'
};

const PERIOD_PHASE_ORDER: PeriodPhaseKey[] = ['menstrual', 'ovulation', 'fertile', 'safe'];

const PERIOD_SEGMENT_START_KEYS = [
  'start',
  'startDate',
  'beginDate',
  'from',
  'startTime',
  'start_time'
];

const PERIOD_SEGMENT_END_KEYS = [
  'end',
  'endDate',
  'finishDate',
  'to',
  'endTime',
  'end_time'
];

const PROFILE_LAST_PERIOD_START_KEYS = [
  'lastMenstruationDate',
  'lastMenstruationStartDate',
  'lastMenstrualStartDate',
  'lastMenstrualDate',
  'lastMenstrualTime',
  'lastMenstruationTime',
  'lastMenstruationStartTime',
  'lastMenstrualDateTime',
  'lastPeriodDate',
  'lastPeriodStartDate',
  'lastPeriodStartTime',
  'recentMenstruationDate',
  'menstruationStartDate',
  'menstruationStartTime',
  'periodStartDate',
  'periodStartTime',
  'lastPeriodTimePoint',
  'startDate'
];

const PROFILE_PERIOD_DATE_LIST_KEYS = [
  'lastPeriodTime',
  'periodDates',
  'menstrualDates',
  'menstruationDates',
  'records'
];

const PROFILE_CYCLE_LENGTH_KEYS = [
  'cycleDay',
  'periodCycle',
  'cycleLength',
  'averageCycle',
  'avgCycle',
  'cycleDays',
  'menstrualCycle'
];

const PROFILE_MENSTRUAL_LENGTH_KEYS = [
  'menstruationDay',
  'periodRuntime',
  'menstrualDays',
  'periodDays',
  'menstrualLength',
  'menstruationLength',
  'periodLength',
  'duration'
];

export function formatPeriodDateYmd(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') {
    const text = value.trim();
    const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (match) {
      return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    }
  }
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getFirstPeriodValue(source: Record<string, any> | null | undefined, keys: string[]): unknown {
  if (!source || typeof source !== 'object') return undefined;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function normalizePeriodPhaseSegment(segment: unknown): PeriodPhaseSegment | undefined {
  if (!segment || typeof segment !== 'object') return undefined;
  const payload = segment as PeriodPhaseSegment;
  const start = formatPeriodDateYmd(getFirstPeriodValue(payload, PERIOD_SEGMENT_START_KEYS) as any);
  const end = formatPeriodDateYmd(getFirstPeriodValue(payload, PERIOD_SEGMENT_END_KEYS) as any);
  return {
    ...payload,
    ...(start ? { start } : {}),
    ...(end ? { end } : {})
  };
}

export function getPeriodPhaseSegment(
  cycle: PeriodPhaseCycle | null | undefined,
  phase: PeriodPhaseKey
): PeriodPhaseSegment | undefined {
  if (!cycle || typeof cycle !== 'object') return undefined;
  let segment: PeriodPhaseSegment | undefined;
  if (phase === 'menstrual') {
    segment = cycle.menstrual || cycle.menstruation || cycle.period;
    return normalizePeriodPhaseSegment(segment);
  }
  if (phase === 'ovulation') {
    segment = cycle.ovulation;
    return normalizePeriodPhaseSegment(segment);
  }
  if (phase === 'fertile') {
    segment = cycle.fertility || cycle.fertile || cycle.follicular;
    return normalizePeriodPhaseSegment(segment);
  }
  segment = cycle.safe || cycle.luteal;
  return normalizePeriodPhaseSegment(segment);
}

export function isDateInPeriodPhase(
  date: Date | string | number,
  cycle: PeriodPhaseCycle | null | undefined,
  phase: PeriodPhaseKey
): boolean {
  const ymd = formatPeriodDateYmd(date);
  const seg = getPeriodPhaseSegment(cycle, phase);
  const start = formatPeriodDateYmd(seg?.start);
  const end = formatPeriodDateYmd(seg?.end);
  if (!ymd || !start || !end) return false;
  return ymd >= start && ymd <= end;
}

export function resolvePeriodPhaseKey(
  date: Date | string | number,
  cycle: PeriodPhaseCycle | null | undefined,
  fallback: PeriodPhaseKey = 'safe'
): PeriodPhaseKey {
  for (const phase of PERIOD_PHASE_ORDER) {
    if (isDateInPeriodPhase(date, cycle, phase)) return phase;
  }
  return fallback;
}

export function resolvePeriodPhaseIndex(
  date: Date | string | number,
  cycle: PeriodPhaseCycle | null | undefined,
  fallback: PeriodPhaseKey = 'safe'
): number {
  return PERIOD_PHASE_INDEX[resolvePeriodPhaseKey(date, cycle, fallback)];
}

export interface PeriodProfilePhaseState {
  phaseKey: PeriodPhaseKey;
  cycleDay: number;
  dayInPhase: number;
  phaseLengths: Record<PeriodPhaseKey, number>;
  cycleStart: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseLocalPeriodDate(value: Date | string | number | null | undefined): Date | null {
  const ymd = formatPeriodDateYmd(value);
  if (!ymd) return null;
  const parts = ymd.split('-').map((item) => Number(item));
  if (parts.length !== 3 || parts.some((item) => !Number.isFinite(item))) return null;
  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addPeriodDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  next.setHours(0, 0, 0, 0);
  return next;
}

function diffPeriodDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / DAY_MS);
}

function clampPeriodInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const integer = Math.round(numeric);
  if (integer < min || integer > max) return fallback;
  return integer;
}

function extractPeriodDateCandidate(value: unknown): string {
  if (value && typeof value === 'object') {
    const payload = value as Record<string, any>;
    return formatPeriodDateYmd(
      getFirstPeriodValue(payload, [
        ...PROFILE_LAST_PERIOD_START_KEYS,
        'date',
        'recordDate',
        'recordTime',
        'record_time',
        'periodDate',
        'menstrualDate',
        'menstruationDate',
        'day',
        'time'
      ]) as any
    );
  }
  return formatPeriodDateYmd(value as any);
}

function normalizePeriodDateCandidates(value: unknown): string[] {
  let rawItems: unknown[];
  if (Array.isArray(value)) {
    rawItems = value;
  } else {
    const text = String(value || '').trim();
    if (!text) return [];
    if (text.startsWith('[') && text.endsWith(']')) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          rawItems = parsed;
        } else {
          rawItems = [text];
        }
      } catch {
        rawItems = text.split(/[,\s，]+/).filter(Boolean);
      }
    } else {
      rawItems = text.split(/[,\s，]+/).filter(Boolean);
    }
  }
  return Array.from(new Set(rawItems.map((item) => extractPeriodDateCandidate(item)).filter(Boolean))).sort();
}

function resolveLastMenstruationStart(profile: Record<string, any>): Date | null {
  const directDate = formatPeriodDateYmd(getFirstPeriodValue(profile, PROFILE_LAST_PERIOD_START_KEYS) as any);
  if (directDate) return parseLocalPeriodDate(directDate);

  let periodDates: string[] = [];
  for (const key of PROFILE_PERIOD_DATE_LIST_KEYS) {
    periodDates = normalizePeriodDateCandidates(profile[key]);
    if (periodDates.length) break;
  }
  if (!periodDates.length) return null;

  const latestCluster = [periodDates[periodDates.length - 1]];
  for (let i = periodDates.length - 2; i >= 0; i -= 1) {
    const current = parseLocalPeriodDate(periodDates[i]);
    const first = parseLocalPeriodDate(latestCluster[0]);
    if (!current || !first || diffPeriodDays(first, current) !== 1) break;
    latestCluster.unshift(periodDates[i]);
  }
  return parseLocalPeriodDate(latestCluster[0]);
}

export function resolvePeriodProfileState(
  date: Date | string | number,
  profile: Record<string, any> | null | undefined
): PeriodProfilePhaseState | null {
  if (!profile || typeof profile !== 'object') return null;
  const selectedDate = parseLocalPeriodDate(date);
  const lastStart = resolveLastMenstruationStart(profile);
  if (!selectedDate || !lastStart) return null;

  const cycleLength = clampPeriodInteger(getFirstPeriodValue(profile, PROFILE_CYCLE_LENGTH_KEYS), 28, 20, 38);
  const menstrualLength = clampPeriodInteger(getFirstPeriodValue(profile, PROFILE_MENSTRUAL_LENGTH_KEYS), 5, 3, 10);
  const daysSinceStart = diffPeriodDays(selectedDate, lastStart);
  const cycleOffset = ((daysSinceStart % cycleLength) + cycleLength) % cycleLength;
  const dayInCycle = cycleOffset + 1;
  const cycleStart = addPeriodDays(selectedDate, -cycleOffset);
  const ovulationDay = Math.min(cycleLength, Math.max(menstrualLength + 1, cycleLength - 14));
  const fertileLength = Math.max(1, ovulationDay - menstrualLength - 1);
  const ovulationLength = 1;
  const safeLength = Math.max(1, cycleLength - menstrualLength - fertileLength - ovulationLength);

  let phaseKey: PeriodPhaseKey = 'safe';
  let dayInPhase = dayInCycle - menstrualLength - fertileLength - ovulationLength;
  if (dayInCycle <= menstrualLength) {
    phaseKey = 'menstrual';
    dayInPhase = dayInCycle;
  } else if (dayInCycle <= menstrualLength + fertileLength) {
    phaseKey = 'fertile';
    dayInPhase = dayInCycle - menstrualLength;
  } else if (dayInCycle <= menstrualLength + fertileLength + ovulationLength) {
    phaseKey = 'ovulation';
    dayInPhase = dayInCycle - menstrualLength - fertileLength;
  } else {
    dayInPhase = Math.max(1, dayInPhase);
  }

  return {
    phaseKey,
    cycleDay: dayInCycle,
    dayInPhase,
    cycleStart: formatPeriodDateYmd(cycleStart),
    phaseLengths: {
      menstrual: menstrualLength,
      fertile: fertileLength,
      ovulation: ovulationLength,
      safe: safeLength
    }
  };
}
