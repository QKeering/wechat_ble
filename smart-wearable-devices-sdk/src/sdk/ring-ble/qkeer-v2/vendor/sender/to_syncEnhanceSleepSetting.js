/**
 * 增强睡眠设置（CMD_SYNC_ENHANCE_SLEEP_SETTING, 0x72）
 *
 * 文档：数据内容共计 1 个字节。
 *  0x00 关闭，0x01 开启（具体以协议为准）
 *
 * @param {Object} [mapData]
 * @param {boolean} [mapData.enable]   true=>1, false=>0
 */
export default function to_syncEnhanceSleepSetting(mapData = {}) {
    let value = mapData.enable ? 0x01 : 0x00;
    
    const db = new ArrayBuffer(1);
    const dv = new DataView(db);
    dv.setUint8(0, value);

    console.log('to_syncEnhanceSleepSetting', mapData, db);

    return db;
}
