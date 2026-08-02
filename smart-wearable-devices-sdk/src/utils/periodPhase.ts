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

export function getPeriodPhaseSegment(
  cycle: PeriodPhaseCycle | null | undefined,
  phase: PeriodPhaseKey
): PeriodPhaseSegment | undefined {
  if (!cycle || typeof cycle !== 'object') return undefined;
  if (phase === 'menstrual') {
    return cycle.menstrual || cycle.menstruation || cycle.period;
  }
  if (phase === 'ovulation') {
    return cycle.ovulation;
  }
  if (phase === 'fertile') {
    return cycle.fertility || cycle.fertile || cycle.follicular;
  }
  return cycle.safe || cycle.luteal;
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
