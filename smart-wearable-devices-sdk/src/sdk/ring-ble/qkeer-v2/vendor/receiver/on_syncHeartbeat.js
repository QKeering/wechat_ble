import util_device_info from '../utils/util_device_info.js';
import device_info from '../utils/util_device_info.js';

/**
 * 心跳包（CMD_SYNC_HEARTBEAT, 0x69）解析
 *
 * @param {ArrayBuffer} arrayBuffer
 * @param {number} packet_sum
 * @param {number} packet_index
 */
export default function on_syncHeartbeat(arrayBuffer, packet_sum, packet_index) {
    console.log('on_syncHeartbeat', arrayBuffer, packet_sum, packet_index);

    const dv = new DataView(arrayBuffer);
    if (dv.byteLength < 14) {
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

    // 11. 疲劳等级（2 字节，0xFFFF 无效）
    const fatigueRaw = dv.getUint16(10, true);
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


    // 13. 焦虑等级（2 字节，0xFFFF 无效）
    const anxietyRaw = dv.getUint16(12, true);
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

    console.log('on_syncHeartbeat', map);

    return map;
}
