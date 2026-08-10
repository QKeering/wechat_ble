import qkeerV2VendorConsole from '../common/debug_console.js';
import util_device_info from '../utils/util_device_info.js';
import receiver_util from './ble_receiver_util.js';

let g_packetArrayBuffer = null;

/**
 * @param {ArrayBuffer} arrayBuffer
 */
export default function on_syncHealthListInfo(arrayBuffer, packet_sum, packet_index) {
    qkeerV2VendorConsole.log('on_syncHealthListInfo', arrayBuffer, packet_sum, packet_index);

    g_packetArrayBuffer = receiver_util.parseReceiverList(g_packetArrayBuffer, arrayBuffer, packet_sum, packet_index);
    if (packet_index < packet_sum - 1) return;

    let list = [];
    const dv = new DataView(g_packetArrayBuffer);
    for (let offset = 0; offset + 8 <= dv.byteLength; offset += 8) {
        const map = {};
        map.timestamp = dv.getUint32(offset, true); // 小端
        map.heartrate = dv.getUint8(offset + 4);
        map.spo2 = dv.getUint8(offset + 5);

        const ot = dv.getUint16(offset + 6, true);
        map.temperature = util_device_info.parseTemperatureInfo(ot);

        list.push(map);
    }

    qkeerV2VendorConsole.log('on_syncHealthListInfo', list);

    return list;
}


