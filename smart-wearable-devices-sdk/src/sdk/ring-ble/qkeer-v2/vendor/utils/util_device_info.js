/**
 * 设备信息相关的工具方法
 * @param {number} batteryInfo 电池信息字节
 */
function parseBatteryInfo(batteryInfo) {
    let map = {};
    if (batteryInfo > 200) {
        map.batteryLevel = 255;
        map.isCharging = 0;
    } else if (batteryInfo > 100) {
        map.batteryLevel = batteryInfo - 100;
        map.isCharging = 1;
    } else {
        map.batteryLevel = batteryInfo;
        map.isCharging = 0;
    }
    return map;
}

function parseMacInfo(arrayBuffer) {
    let db_vi = new DataView(arrayBuffer);
    let macBytes = [];
    for (let i = 0; i < 6; i++) {
        let macByte = db_vi.getUint8(i);
        macBytes.push(macByte.toString(16).padStart(2, '0'));
    }
    return macBytes.join(':').toUpperCase();
}

function parseTemperatureInfo(ot) {
    if(ot == 0)
        return 0;
    return ot * 0.0078125 + 1.3; // Temp = OT * 0.0078125 + 1.3
}


export default {
    parseBatteryInfo: parseBatteryInfo,
    parseMacInfo: parseMacInfo,
    parseTemperatureInfo: parseTemperatureInfo,
};