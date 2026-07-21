/**
 * 同步用户信息
 *
 * 字节结构：
 * 0  性别   1 字节：0x00 女，0x01 男，0xFF 不设置
 * 1  年龄   1 字节：如 0x1E 表示 30 岁，0xFF 不设置
 * 2  身高   1 字节：单位 cm，如 0xAA 表示 170cm，0xFF 不设置
 * 3  体重   1 字节：单位 kg，如 0x3C 表示 60kg，0xFF 不设置
 * 4~7 时间  4 字节：秒级 Unix 时间戳，例如 0x63841D2E (2022-11-28 10:30:06)
 * 8  时区   1 字节：如东八区 0x08 (UTC+8)，西十区 0xF6 (UTC-10)
 *
 * @param {Object} mapData
 * @param {number} mapData.sex    性别
 * @param {number} mapData.age       年龄
 * @param {number} mapData.height    身高(cm)
 * @param {number} mapData.weight    体重(kg)
 * @param {number} mapData.timestamp Unix 时间戳（秒）
 * @param {number} mapData.timezone  时区值
 */
export default function to_syncUserInfo(mapData) {

    // 共 9 个字节
    let db = new ArrayBuffer(9);
    let db_vi = new DataView(db);

    // 按协议顺序写入
    db_vi.setUint8(0, mapData.sex & 0xFF);
    db_vi.setUint8(1, mapData.age & 0xFF);
    db_vi.setUint8(2, mapData.height & 0xFF);
    db_vi.setUint8(3, mapData.weight & 0xFF);

    // 时间：4 字节，示例 0x63841D2E（小端）
    // 第三个参数 小端 true
    db_vi.setUint32(4, mapData.timestamp >>> 0, true);

    // 时区：1 字节
    db_vi.setUint8(8, mapData.timezone & 0xFF);

    console.log('to_syncUserInfo', mapData, db);

    return db;
}


