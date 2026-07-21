import util_device_info from '../utils/util_device_info.js';
import device_info from '../utils/util_device_info.js';

/**
 * 预览当天最后记录数据（CMD_SYNC_LAST_DATA, 0x70）解析
 *
 * @param {ArrayBuffer} arrayBuffer
 * @param {number} packet_sum
 * @param {number} packet_index
 */
export default function on_syncLastData(arrayBuffer, packet_sum, packet_index) {
    console.log('on_syncLastData', arrayBuffer, packet_sum, packet_index);

    const dv = new DataView(arrayBuffer);
    if (dv.byteLength < 22) {
        return;
    }

    const map = {};

    // 1. 电量（1 字节，最高位充电标志，其余为 0~100）
    const batteryInfo = dv.getUint8(0);
    let batteryMap = device_info.parseBatteryInfo(batteryInfo);
    map.isCharging = batteryMap.isCharging;
    map.batteryLevel = batteryMap.batteryLevel;

    // 2. 佩戴状态（1 字节）
    const wearRaw = dv.getUint8(1);
    map.isWorn = wearRaw === 0x01;

    // 3. 当天总步数（4 字节）
    const stepTotal = dv.getUint32(2, true);
    map.step = stepTotal;

    // 7. 心率（1 字节，0xFF 表示无效）
    const hrRaw = dv.getUint8(6);
    map.heartRate = hrRaw === 0xFF ? null : hrRaw;

    // 8. 血氧（1 字节，0xFF 表示无效）
    const spo2Raw = dv.getUint8(7);
    map.spo2 = spo2Raw === 0xFF ? null : spo2Raw;

    // 9. 体温（2 字节，带符号）
    const ot = dv.getInt16(8, true);
    map.temperature = util_device_info.parseTemperatureInfo(ot);

    // 11. 睡眠（清醒）时间（分钟）
    const awakeMinutes = dv.getUint16(10, true);
    map.sleepAwakeMinutes = awakeMinutes;

    // 13. 睡眠（深睡）时间（分钟）
    const deepMinutes = dv.getUint16(12, true);
    map.sleepDeepMinutes = deepMinutes;

    // 15. 睡眠（浅睡）时间（分钟）
    const lightMinutes = dv.getUint16(14, true);
    map.sleepLightMinutes = lightMinutes;

    // 17. 睡眠（REM）时间（分钟）
    const remMinutes = dv.getUint16(16, true);
    map.sleepRemMinutes = remMinutes;

    // 汇总一个总睡眠时长，方便 UI 使用
    const awake = map.sleepAwakeMinutes || 0;
    const deep = map.sleepDeepMinutes || 0;
    const light = map.sleepLightMinutes || 0;
    const rem = map.sleepRemMinutes || 0;
    map.sleepTotalMinutes = awake + deep + light + rem;

    // 19. 疲劳等级
    const fatigueRaw = dv.getUint16(18, true);
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


    // 21. 焦虑等级
    const anxietyRaw = dv.getUint16(20, true);
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

    console.log('on_syncLastData', map);
    return map;
}
