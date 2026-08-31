export type RingWearState = 'unknown' | 'worn' | 'not_worn' | 'charging';

const getRecordTimeMs = (record: Record<string, any>) => {
  const raw =
    record.receivedAt ??
    record.received_at ??
    record.parsedAt ??
    record.collectedAt ??
    record.timestamp ??
    record.recordTimestamp ??
    record.recordTime ??
    record.createdAt ??
    record.time ??
    record.metrics?.receivedAt ??
    record.metrics?.collectedAt ??
    record.metrics?.timestamp ??
    record.raw?.receivedAt ??
    record.raw?.collectedAt ??
    record.raw?.timestamp;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = typeof raw === 'string' ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const getRingMeasurementRecords = (records: unknown[], startedAt: number) =>
  (Array.isArray(records) ? records : []).filter((item) => {
    const record = (item || {}) as Record<string, any>;
    const recordTime = getRecordTimeMs(record);
    return recordTime > 0 && recordTime >= startedAt;
  });

/**
 * 只判断调用方传入的本次测量回包，避免历史回包把未佩戴误判为测量成功。
 */
export const resolveRingWearState = (records: unknown[]): RingWearState => {
  const safeRecords = Array.isArray(records) ? records : [];
  for (let index = safeRecords.length - 1; index >= 0; index -= 1) {
    const record = (safeRecords[index] || {}) as Record<string, any>;
    const type = String(record.sourceType || record.type || record.raw?.type || '');
    const statusText = String(
      record.status ??
        record.statusText ??
        record.message ??
        record.msg ??
        record.metrics?.statusText ??
        record.metrics?.message ??
        record.raw?.statusText ??
        record.raw?.status ??
        ''
    ).trim();
    const alarmFlags =
      record.alarmFlags || record.alarm_flags || record.metrics?.alarmFlags || record.metrics?.alarm_flags || record.raw?.alarmFlags || {};
    const protocol = String(record.protocol || record.raw?.protocol || '').toLowerCase();
    const packetShape = String(record.packetShape || record.raw?.packetShape || '').toLowerCase();

    if (
      record.isWorn === false ||
      record.is_worn === false ||
      alarmFlags.notWorn === true ||
      alarmFlags.probeOff === true ||
      alarmFlags.probeUnplugged === true ||
      alarmFlags.noPulse === true ||
      /未佩戴|探头脱落|探头未接/.test(statusText)
    ) {
      return 'not_worn';
    }

    if (record.isCharging === true || record.is_charging === true || /充电/.test(statusText)) {
      return 'charging';
    }

    if (type === 'active_measure' || type === 'active_OxyGenMeasure') {
      const legacyStatus =
        type === 'active_OxyGenMeasure'
          ? record.bloodOxygenStatus ?? record.metrics?.status ?? record.raw?.bloodOxygenStatus
          : record.heartbeatStatus ?? record.metrics?.status ?? record.raw?.heartbeatStatus;
      const rwNack =
        protocol === 'rw' &&
        (record.statusCode === 0x31 || record.raw?.statusCode === 0x31 || String(record.raw?.status || '').toLowerCase() === 'nack');
      // RW 原生指标会为了兼容旧页面合成 heartbeatStatus/bloodOxygenStatus，
      // 这些状态只代表“收到数值”，不是硬件佩戴确认，不能作为门禁依据。
      const isSyntheticRwAlias = protocol === 'rw' && packetShape !== 'legacy_compat';
      if (!isSyntheticRwAlias) {
        if (legacyStatus === 0x00) return 'not_worn';
        if (legacyStatus === 0x02 && !rwNack) return 'charging';
        if (legacyStatus === 0x01) return 'worn';
      }
    }

    if (record.isWorn === true || record.is_worn === true) return 'worn';
    // QKeer V2 的单次检测回包包含独立的报警字节。只有“检测完成且报警字节明确无异常”
    // 才能确认佩戴；心率/血氧为正数本身不是佩戴证据（摘下时光学传感器也可能产生伪值）。
    if (
      protocol === 'qkeer-v2' &&
      /检测完成/.test(statusText) &&
      Object.keys(alarmFlags).length > 0 &&
      !Object.values(alarmFlags).some(Boolean)
    ) {
      return 'worn';
    }
  }
  return 'unknown';
};

let guidanceVisible = false;

export const showRingWearGuidance = (kind: 'not_worn' | 'charging' | 'no_data') => {
  if (guidanceVisible) return;
  const guidance = {
    not_worn: {
      title: '请先正确佩戴戒指',
      content: '请将戒指戴在手指根部，确保传感器贴合皮肤，保持手部静止后重新测量。'
    },
    charging: {
      title: '请先取出并佩戴戒指',
      content: '请先将戒指拿出充电仓，戴在手指根部并确保传感器贴合皮肤后重新测量。'
    },
    no_data: {
      title: '暂未获取到有效数据',
      content: '请确认戒指已戴在手指根部，传感器贴合皮肤，并保持手部静止后重新测量。'
    }
  }[kind];

  guidanceVisible = true;
  uni.showModal({
    title: guidance.title,
    content: guidance.content,
    showCancel: false,
    confirmText: '我知道了',
    complete: () => {
      guidanceVisible = false;
    }
  });
};

export type RingWearPreflightResult = {
  supported: boolean;
  state: RingWearState;
  protocol?: string;
  record?: Record<string, any>;
};

/**
 * 实时测量统一前置门禁：必须先由设备明确确认佩戴。
 * 不支持、超时或未知状态一律不放行，避免退化成测量后的结果门禁。
 */
export const ensureRingWornBeforeMeasurement = async (
  queryCurrentWearState: () => Promise<RingWearPreflightResult>
) => {
  try {
    const result = await queryCurrentWearState();
    if (result.supported && result.state === 'worn') return true;
    showRingWearGuidance(result.state === 'charging' ? 'charging' : result.state === 'not_worn' ? 'not_worn' : 'no_data');
    return false;
  } catch {
    showRingWearGuidance('no_data');
    return false;
  }
};
