/**
 * 增强睡眠读取（CMD_SYNC_ENHANCE_SLEEP_READ, 0x73）
 *
 * 文档：数据内容共计 1 个字节。
 *
 * @param {Object} [mapData]
 * @param {number} [mapData.value]  自定义值，默认 0x00
 */
export default function to_syncEnhanceSleepRead(mapData = {}) {
    const value =  0x00;

    const db = new ArrayBuffer(1);
    const dv = new DataView(db);
    dv.setUint8(0, value);

    console.log('to_syncEnhanceSleepRead', mapData, db);

    return db;
}
