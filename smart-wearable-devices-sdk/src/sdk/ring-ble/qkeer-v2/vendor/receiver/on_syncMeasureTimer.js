/**
 * 监测定时 0x0A 回复解析
 *
 * DATA 共 6 字节：
 * 0: 开关        0x00 关闭，0x01 开启
 * 1: 开始小时    0~23
 * 2: 开始分钟    0~59
 * 3: 停止小时    0~23
 * 4: 停止分钟    0~59
 * 5: 检测频率    1 分:0x01, 5 分:0x05, 10 分:0x0A ...（值=分钟数）
 *
 * @param {ArrayBuffer} arrayBuffer
 */
export default function on_syncMeasureTimer(arrayBuffer, packet_sum, packet_index) {
    console.log('on_syncMeasureTimer', arrayBuffer, packet_sum, packet_index);

    const dv = new DataView(arrayBuffer);
    if (dv.byteLength < 6) {
        return;
    }

    const enableRaw = dv.getUint8(0);
    const startHour = dv.getUint8(1);
    const startMin = dv.getUint8(2);
    const stopHour = dv.getUint8(3);
    const stopMin = dv.getUint8(4);
    const frequency = dv.getUint8(5);

    const map = {
        enabled: enableRaw === 0x01,
        startHour,
        startMin,
        stopHour,
        stopMin,
        frequency,
    };

    console.log('on_syncMeasureTimer', map);

    return map;
}
