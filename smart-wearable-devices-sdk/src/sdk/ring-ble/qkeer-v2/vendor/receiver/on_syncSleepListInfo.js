import receiver_util from './ble_receiver_util.js';

let g_packetArrayBuffer = null;

/**
 * @param {ArrayBuffer} arrayBuffer
 * 睡眠类型: 0x00 普通睡眠，0x01 其他睡眠
 * 开始时间: 例如:0x6384B7D8(2022-11-28 21:30:00+0008)
 * 睡眠状态: 0x00 进入睡眠，0x01 浅睡，0x02深睡，0x03清醒，0x04 REM，0x05退出睡眠
 * 睡眠时长: 分钟高位 分钟低位
 */
export default function on_syncSleepListInfo(arrayBuffer, packet_sum, packet_index) {
    console.log('on_syncSleepListInfo', arrayBuffer, packet_sum, packet_index);

    g_packetArrayBuffer = receiver_util.parseReceiverList(g_packetArrayBuffer, arrayBuffer, packet_sum, packet_index);
    if (packet_index < packet_sum - 1) return;

    let list = [];
    const dv = new DataView(g_packetArrayBuffer);
    for (let offset = 0; offset + 8 <= dv.byteLength; offset += 8) {
        const map = {};
        map.type = dv.getUint8(offset);
        map.timestamp = dv.getUint32(offset + 1, true); // 小端
        map.status = dv.getUint8(offset + 5);
        map.timeLen = dv.getUint16(offset + 6, true);
        list.push(map);
    }

    console.log('on_syncSleepListInfo', list);

    return list;
}


