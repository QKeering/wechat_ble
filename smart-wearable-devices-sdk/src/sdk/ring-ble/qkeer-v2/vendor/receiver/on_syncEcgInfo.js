import receiver_util from './ble_receiver_util.js';

let g_packetArrayBuffer = null;

/**
 * @param {ArrayBuffer} arrayBuffer
 */
export default function on_syncEcgInfo(arrayBuffer, packet_sum, packet_index) {
    console.log('on_syncEcgInfo', arrayBuffer, packet_sum, packet_index);

    g_packetArrayBuffer = receiver_util.parseReceiverList(g_packetArrayBuffer, arrayBuffer, packet_sum, packet_index);
    if (packet_index < packet_sum - 1) return;

    let list = [];

    // 后续实现

    console.log('on_syncEcgInfo', list);

    return list;
}


