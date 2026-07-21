/**
 * @param {ArrayBuffer} arrayBuffer
 * 时间: 例如:0x6384B7D8(2022-11-28 21:30:00+0008)
 * 步数: 
 */
export default function on_syncStepInfo(arrayBuffer, packet_sum, packet_index) {
    console.log('on_syncStepInfo', arrayBuffer, packet_sum, packet_index);

    const dv = new DataView(arrayBuffer);
    if (dv.byteLength < 8)
        return;

    const map = {};
    const offset = 0;
    map.timestamp = dv.getUint32(offset, true); // 小端
    map.step = dv.getUint32(offset + 4, true);

    console.log('on_syncStepInfo', map);

    return map;
}


