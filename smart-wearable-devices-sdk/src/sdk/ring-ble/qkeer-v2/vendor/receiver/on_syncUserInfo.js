// 处理获取设备信息的响应
/**
 * @param {ArrayBuffer} arrayBuffer
 */
export default function on_syncUserInfo(arrayBuffer, packet_sum, packet_index) {
    console.log('on_syncUserInfo', arrayBuffer, packet_sum, packet_index);

    let db_vi = new DataView(arrayBuffer);
    if (db_vi.byteLength < 1)
        return;

    let map = {};

    map.isSuccess = db_vi.getUint8(0);

    console.log('on_syncUserInfo', map);

    return map;
}