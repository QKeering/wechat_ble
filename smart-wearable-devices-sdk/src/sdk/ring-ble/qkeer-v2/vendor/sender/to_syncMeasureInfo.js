/**
 * 单次检测（CMD_SYNC_MEASURE, 0x05）
 *
 * 协议：DATA 只有 2 个字节，用 bit 表示要检测的项目。
 *   bit0 = 心率
 *   bit1 = 血氧
 *   bit2 = 焦虑
 *
 * 也支持直接传 rawMask 覆盖整个 1 字节。
 *
 * @param {Object} [mapData]
 * @param {boolean} [mapData.measureHeartRate]  是否检测心率
 * @param {boolean} [mapData.measureSpo2]       是否检测血氧
 * @param {boolean} [mapData.measureAnxiety]    是否检测焦虑
 * @param {number}  [mapData.rawMask]           直接指定 1 字节掩码（0~255），优先级最高
 * @param {boolean} [mapData.open]              开关，true 开启检测，false 关闭检测（默认开启）
 * @returns {ArrayBuffer}
 */
export default function to_syncMeasureInfo(mapData = {}) {

    let mask = 0;

    if (typeof mapData.rawMask === 'number') {
        mask = mapData.rawMask & 0xFF;
    } else if (mapData.measureSpo2) {
        mask = 0x01;
    } else if (mapData.measureAnxiety) {
        mask = 0x02;
    } else {
        mask = 0x00;
    }

    const db = new ArrayBuffer(1);
    const dv = new DataView(db);
    dv.setUint8(0, mask);
    console.log('to_syncMeasureInfo', mapData, mask, db);

    return db;
}
