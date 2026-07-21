import ble_ota_data from '../common/ble_ota_data.js';

// OTA 写入文件响应
/**
 * @param {ArrayBuffer} arrayBuffer
 */
export default function on_syncOtaWrite(arrayBuffer, packet_sum, packet_index) {
    console.log('on_syncOtaWrite', arrayBuffer, packet_sum, packet_index);

    const dv = new DataView(arrayBuffer);
    if (dv.byteLength < 1)
        return;

    const map = {};
    map.status = dv.getUint8(0);
    if (dv.byteLength >= 1 + 4) {
        map.index = dv.getUint32(1, true);
    } else {
        map.index = 0;
    }

    console.log('on_syncOtaWrite', map);

    ble_ota_data.sendOtaDataWrite();

    return map;
}
