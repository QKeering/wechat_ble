import device_info from '../utils/util_device_info.js';

// 处理获取设备信息的响应
/**
 * @param {ArrayBuffer} arrayBuffer
 */
export default function on_syncDeviceInfo(arrayBuffer, packet_sum, packet_index) {
    console.log('syncDeviceInfo', arrayBuffer, packet_sum, packet_index);

    let db_vi = new DataView(arrayBuffer);
    if (db_vi.byteLength < 13)
        return;

    let map = {};

    let batteryInfo = db_vi.getUint8(0);
    let batteryMap = device_info.parseBatteryInfo(batteryInfo);
    map.isCharging = batteryMap.isCharging;
    map.batteryLevel = batteryMap.batteryLevel;

    let hardInfo = db_vi.getUint16(1, true);
    let hardwareVersion_1 = (hardInfo >> 8) & 0xFF;
    let hardwareVersion_2 = hardInfo & 0xFF;
    map.hardVersion = hardwareVersion_2.toString() + '.' + hardwareVersion_1.toString();

    let softInfo = db_vi.getUint32(3, true);
    let softInfoVersion_1 = (softInfo >> 24) & 0xFF;
    let softInfoVersion_2 = (softInfo >> 16) & 0xFF;
    let softInfoVersion_3 = (softInfo >> 8) & 0xFF;
    let softInfoVersion_4 = (softInfo) & 0xFF;
    map.softInfo = softInfoVersion_4.toString() + '.'
        + softInfoVersion_3.toString() + '.'
        + softInfoVersion_2.toString() + '.'
        + softInfoVersion_1.toString();

    let macArrayBuffer = arrayBuffer.slice(7, 13);
    map.mac = device_info.parseMacInfo(macArrayBuffer);

    console.log('syncDeviceInfo', map);

    return map;
}