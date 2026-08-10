import qkeerV2VendorConsole from '../common/debug_console.js';
// OTA 文件写入结束响应
/**
 * @param {ArrayBuffer} arrayBuffer
 */
export default function on_syncOtaEnd(arrayBuffer, packet_sum, packet_index) {
    qkeerV2VendorConsole.log('on_syncOtaEnd', arrayBuffer, packet_sum, packet_index);

    const dv = new DataView(arrayBuffer);
    if (dv.byteLength < 1) {
        return;
    }

    const status = dv.getUint8(0);
    const map = {
        isSuccess: status === 0x01,
    };

    qkeerV2VendorConsole.log('on_syncOtaEnd', map);
    return map;
}
