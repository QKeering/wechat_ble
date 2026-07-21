import util_device_info from "../utils/util_device_info";

/**
 * @param {ArrayBuffer} arrayBuffer
 */
export default function on_syncHealthInfo(arrayBuffer, packet_sum, packet_index) {
    console.log('on_syncHealthInfo', arrayBuffer, packet_sum, packet_index);

    const dv = new DataView(arrayBuffer);
    if (dv.byteLength < 8)
        return;

    const map = {};
    const offset = 0;
    map.timestamp = dv.getUint32(offset, true); // 小端
    map.heartrate = dv.getUint8(offset + 4);
    map.heartRate = map.heartrate;
    map.spo2 = dv.getUint8(offset + 5);

    const ot = dv.getUint16(offset + 6, true);
    map.temperature = util_device_info.parseTemperatureInfo(ot);

    console.log('on_syncHealthInfo', map);

    return map;
}


