/**
 * 恢复出厂设置（CMD_SYNC_RESET, 0x0B）
 *
 * 文档：数据内容共计 1 个字节。
 * 实际含义按协议填写，这里只约定：
 *   - 默认发 0x01 表示“确认恢复出厂”
 *
 * @param {Object} [mapData]
 * @param {number|boolean} [mapData.value]  自定义值；true=>0x01, false=>0x00
 */
export default function to_syncReset(mapData = {}) {
    let value = 0x01;

    const db = new ArrayBuffer(1);
    const dv = new DataView(db);
    dv.setUint8(0, value);

    console.log('to_syncReset', mapData, db);

    return db;
}
