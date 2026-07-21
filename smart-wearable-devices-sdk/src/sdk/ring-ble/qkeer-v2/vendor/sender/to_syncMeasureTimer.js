/**
 * 监测定时（CMD_SYNC_MEASURE_TIMER, 0x0A）
 *
 * 文档：数据内容共计 7 个字节。
 * @param {Object} [mapData]
 * @param {boolean} [mapData.isSetup]
 * @param {boolean} [mapData.enable]
 * @param {number} [mapData.startHour]
 * @param {number} [mapData.startMin]
 * @param {number} [mapData.endHour]
 * @param {number} [mapData.endMin]
 * @param {number} [mapData.frequency] 频率，单位：分钟
 */
export default function to_syncMeasureTimer(mapData = {}) {
    let db = new ArrayBuffer(7);
    let dv = new DataView(db);

    // 设置 01，读取 00
    if (mapData.isSetup) {
        dv.setUint8(0, 0x01);
    } else {
        dv.setUint8(0, 0x00);
    }

    if (mapData.enable) {
        dv.setUint8(1, 0x01);
    } else {
        dv.setUint8(1, 0x00);
    }

    dv.setUint8(2, mapData.startHour);
    dv.setUint8(3, mapData.startMin);

    dv.setUint8(4, mapData.endHour);
    dv.setUint8(5, mapData.endMin);

    dv.setUint8(6, mapData.frequency);

    console.log('to_syncMeasureTimer', mapData, db);

    return db;
}
