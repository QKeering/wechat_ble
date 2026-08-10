import qkeerV2VendorConsole from '../common/debug_console.js';
// 增强睡眠设置响应
/**
 * @param {ArrayBuffer} arrayBuffer
 */
export default function on_syncEnhanceSleepSetting(arrayBuffer, packet_sum, packet_index) {
    qkeerV2VendorConsole.log('on_syncEnhanceSleepSetting', arrayBuffer, packet_sum, packet_index);

    const dv = new DataView(arrayBuffer);
    if (dv.byteLength < 1) {
        return;
    }

    const value = dv.getUint8(0);
    const map = {
        enabled: value !== 0,
    };

    qkeerV2VendorConsole.log('on_syncEnhanceSleepSetting', map);
    
    return map;
}
