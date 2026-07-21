// OTA 文件写入结束响应
/**
 * @param {ArrayBuffer} arrayBuffer
 */
export default function on_syncOtaEnd(arrayBuffer, packet_sum, packet_index) {
    console.log('on_syncOtaEnd', arrayBuffer, packet_sum, packet_index);

    const dv = new DataView(arrayBuffer);
    if (dv.byteLength < 1) {
        return;
    }

    const status = dv.getUint8(0);
    const map = {
        isSuccess: status === 0x01,
    };

    console.log('on_syncOtaEnd', map);
    return map;
}
