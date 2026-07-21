import ble_ota_data from '../common/ble_ota_data.js';

// OTA 指令响应
/**
 * @param {ArrayBuffer} arrayBuffer
 */
export default function on_syncOtaStart(arrayBuffer, packet_sum, packet_index) {
    console.log('on_syncOtaStart', arrayBuffer, packet_sum, packet_index);

    const dv = new DataView(arrayBuffer);
    if (dv.byteLength < 1) {
        return;
    }

    const value = dv.getUint8(0);
    const map = {
        enable: value !== 0,
    };

    console.log('on_syncOtaStart', map);

    ble_ota_data.sendOtaDataWrite();

    return map;
}
