import receiver_util from './ble_receiver_util.js';

let g_packetArrayBuffer = null;

/**
 * @param {ArrayBuffer} arrayBuffer
 * 时间: 例如:0x6384B7D8(2022-11-28 21:30:00+0008)
 * 步数: 
 */
export default function on_syncStepListInfo(arrayBuffer, packet_sum, packet_index) {
    console.log('on_syncStepListInfo', arrayBuffer, packet_sum, packet_index);

    g_packetArrayBuffer = receiver_util.parseReceiverList(g_packetArrayBuffer, arrayBuffer, packet_sum, packet_index);
    if (packet_index < packet_sum - 1) return;

    let list = [];
    const dv = new DataView(g_packetArrayBuffer);
    for (let offset = 0; offset + 8 <= dv.byteLength; offset += 8) {
        const map = {};
        map.timestamp = dv.getUint32(offset, true); // 小端
        map.step = dv.getUint32(offset + 4, true);
        list.push(map);
    }

    console.log('on_syncStepListInfo', list);

    return list;
}


