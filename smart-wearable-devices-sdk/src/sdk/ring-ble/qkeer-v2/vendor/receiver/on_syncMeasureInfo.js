/*
数据共 8 字节，各字段含义：
位置1：状态（1 字节）
    0x00 准备检测
    0x01 检测中
    0x02 检测完成
    0x03 检测失败
位置2：心率值（1 字节），例如 0x50 = 80 bpm，异常可传 0xFF
位置3：血氧值（1 字节），例如 0x63 = 99%，异常可传 0xFF
位置4~5：疲劳（2 字节，举例 0x012C = 300，如异常可传 0xFFFF）
    ＜300：不疲劳
    300~360：轻度疲劳
    360~420：中度疲劳
    ＞420：重度疲劳
位置6~7：焦虑（2 字节，举例 0x012C = 300，如异常可传 0xFFFF）
    ＜300：不焦虑
    300~700：轻度焦虑
    700~1000：中度焦虑
    ＞1000：重度焦虑
位置8：报警（1 字节，最低位到最高位依次）：
    bit0：探头脱落
    bit1：探头未接
    bit2：探头故障
    bit3：低灌注水平
    bit4：搜索脉搏
    bit5：运动干扰
    bit6：无脉搏
    bit7：未佩戴
    0x00：无异常
*/

/**
 * 单次检测结果解析
 * @param {ArrayBuffer} arrayBuffer
 * @param {number} packet_sum
 * @param {number} packet_index
 */
export default function on_syncMeasureInfo(arrayBuffer, packet_sum, packet_index) {
    console.log('on_syncMeasureInfo', arrayBuffer, packet_sum, packet_index);

    const dv = new DataView(arrayBuffer);
    if (dv.byteLength < 8) {
        console.warn('on_syncMeasureInfo: length error', dv.byteLength);
        return;
    }

    const map = {};

    // 1. 状态
    const status = dv.getUint8(0);
    map.status = status;
    map.statusText = {
        0x00: '准备检测',
        0x01: '检测中',
        0x02: '检测完成',
        0x03: '检测失败',
    }[status] || '未知状态';

    // 2. 心率值
    const hrRaw = dv.getUint8(1);
    map.heartRateRaw = hrRaw;
    map.heartRate = hrRaw === 0xFF ? null : hrRaw; // 0xFF 表示无效

    // 3. 血氧值
    const spo2Raw = dv.getUint8(2);
    map.spo2Raw = spo2Raw;
    map.spo2 = spo2Raw === 0xFF ? null : spo2Raw; // 0xFF 表示无效

    // 4~5. 疲劳（2 字节）
    // 文档示例 0x012C (300)，这里按大端解析
    const fatigueRaw = dv.getUint16(3, false); // false = big-endian
    map.fatigueRaw = fatigueRaw;
    if (fatigueRaw === 0xFFFF) {
        map.fatigue = null;
        map.fatigueLevel = '无效';
    } else {
        map.fatigue = fatigueRaw;
        if (fatigueRaw < 300) {
            map.fatigueLevel = '不疲劳';
        } else if (fatigueRaw <= 360) {
            map.fatigueLevel = '轻度疲劳';
        } else if (fatigueRaw <= 420) {
            map.fatigueLevel = '中度疲劳';
        } else {
            map.fatigueLevel = '重度疲劳';
        }
    }

    // 6~7. 焦虑（2 字节）
    const anxietyRaw = dv.getUint16(5, false); // 同上，按大端
    map.anxietyRaw = anxietyRaw;
    if (anxietyRaw === 0xFFFF) {
        map.anxiety = null;
        map.anxietyLevel = '无效';
    } else {
        map.anxiety = anxietyRaw;
        if (anxietyRaw < 300) {
            map.anxietyLevel = '不焦虑';
        } else if (anxietyRaw <= 700) {
            map.anxietyLevel = '轻度焦虑';
        } else if (anxietyRaw <= 1000) {
            map.anxietyLevel = '中度焦虑';
        } else {
            map.anxietyLevel = '重度焦虑';
        }
    }

    // 8. 报警（1 字节，bit0 ~ bit7）
    const alarm = dv.getUint8(7);
    map.alarmRaw = alarm;

    const alarmFlags = {
        probeOff:      !!(alarm & 0x01), // 探头脱落
        probeUnplugged:!!(alarm & 0x02), // 探头未接
        probeError:    !!(alarm & 0x04), // 探头故障
        lowPerfusion:  !!(alarm & 0x08), // 低灌注水平
        searchingPulse:!!(alarm & 0x10), // 搜索脉搏
        motionArtifact:!!(alarm & 0x20), // 运动干扰
        noPulse:       !!(alarm & 0x40), // 无脉搏
        notWorn:       !!(alarm & 0x80), // 未佩戴
    };
    map.alarmFlags = alarmFlags;

    const alarmTextList = [];
    if (alarmFlags.probeOff)       alarmTextList.push('探头脱落');
    if (alarmFlags.probeUnplugged) alarmTextList.push('探头未接');
    if (alarmFlags.probeError)     alarmTextList.push('探头故障');
    if (alarmFlags.lowPerfusion)   alarmTextList.push('低灌注水平');
    if (alarmFlags.searchingPulse) alarmTextList.push('搜索脉搏');
    if (alarmFlags.motionArtifact) alarmTextList.push('运动干扰');
    if (alarmFlags.noPulse)        alarmTextList.push('无脉搏');
    if (alarmFlags.notWorn)        alarmTextList.push('未佩戴');

    map.alarmText =
        alarm === 0x00 ? '无异常' : alarmTextList.join('、') || '未知报警';

    console.log('on_syncMeasureInfo parsed', map);

    return map;
}
