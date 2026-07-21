/**
 * 取计步信息
 *
 * 协议结构（共 8 字节）：
 * 0~3 字节：开始时间（4 字节 Unix 时间戳）
 *           例如：0x63841D2E (2022-11-28 10:30:06 +0008)
 * 4~7 字节：结束时间（4 字节 Unix 时间戳）
 *           例如：0x6384B7D8 (2022-11-28 21:30:00 +0008)
 *
 * @param {number} mapData.startTimestamp  开始时间 Unix 时间戳（秒）
 * @param {number} mapData.endTimestamp    结束时间 Unix 时间戳（秒）
 */
export default function to_syncStepInfo(mapData) {

    // 共 8 个字节
    let db = new ArrayBuffer(8);
    let db_vi = new DataView(db);

    // 按协议写入时间（小端）
    db_vi.setUint32(0, mapData.startTimestamp >>> 0, true); // 开始时间
    db_vi.setUint32(4, mapData.endTimestamp >>> 0, true);   // 结束时间

    console.log('to_syncStepInfo', mapData, db);

    return db;
}


