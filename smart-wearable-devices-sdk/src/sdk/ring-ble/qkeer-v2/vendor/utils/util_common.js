const crc32_tab = [
	0x00000000, 0x77073096, 0xee0e612c, 0x990951ba, 0x076dc419, 0x706af48f,
	0xe963a535, 0x9e6495a3, 0x0edb8832, 0x79dcb8a4, 0xe0d5e91e, 0x97d2d988,
	0x09b64c2b, 0x7eb17cbd, 0xe7b82d07, 0x90bf1d91, 0x1db71064, 0x6ab020f2,
	0xf3b97148, 0x84be41de, 0x1adad47d, 0x6ddde4eb, 0xf4d4b551, 0x83d385c7,
	0x136c9856, 0x646ba8c0, 0xfd62f97a, 0x8a65c9ec, 0x14015c4f, 0x63066cd9,
	0xfa0f3d63, 0x8d080df5, 0x3b6e20c8, 0x4c69105e, 0xd56041e4, 0xa2677172,
	0x3c03e4d1, 0x4b04d447, 0xd20d85fd, 0xa50ab56b, 0x35b5a8fa, 0x42b2986c,
	0xdbbbc9d6, 0xacbcf940, 0x32d86ce3, 0x45df5c75, 0xdcd60dcf, 0xabd13d59,
	0x26d930ac, 0x51de003a, 0xc8d75180, 0xbfd06116, 0x21b4f4b5, 0x56b3c423,
	0xcfba9599, 0xb8bda50f, 0x2802b89e, 0x5f058808, 0xc60cd9b2, 0xb10be924,
	0x2f6f7c87, 0x58684c11, 0xc1611dab, 0xb6662d3d, 0x76dc4190, 0x01db7106,
	0x98d220bc, 0xefd5102a, 0x71b18589, 0x06b6b51f, 0x9fbfe4a5, 0xe8b8d433,
	0x7807c9a2, 0x0f00f934, 0x9609a88e, 0xe10e9818, 0x7f6a0dbb, 0x086d3d2d,
	0x91646c97, 0xe6635c01, 0x6b6b51f4, 0x1c6c6162, 0x856530d8, 0xf262004e,
	0x6c0695ed, 0x1b01a57b, 0x8208f4c1, 0xf50fc457, 0x65b0d9c6, 0x12b7e950,
	0x8bbeb8ea, 0xfcb9887c, 0x62dd1ddf, 0x15da2d49, 0x8cd37cf3, 0xfbd44c65,
	0x4db26158, 0x3ab551ce, 0xa3bc0074, 0xd4bb30e2, 0x4adfa541, 0x3dd895d7,
	0xa4d1c46d, 0xd3d6f4fb, 0x4369e96a, 0x346ed9fc, 0xad678846, 0xda60b8d0,
	0x44042d73, 0x33031de5, 0xaa0a4c5f, 0xdd0d7cc9, 0x5005713c, 0x270241aa,
	0xbe0b1010, 0xc90c2086, 0x5768b525, 0x206f85b3, 0xb966d409, 0xce61e49f,
	0x5edef90e, 0x29d9c998, 0xb0d09822, 0xc7d7a8b4, 0x59b33d17, 0x2eb40d81,
	0xb7bd5c3b, 0xc0ba6cad, 0xedb88320, 0x9abfb3b6, 0x03b6e20c, 0x74b1d29a,
	0xead54739, 0x9dd277af, 0x04db2615, 0x73dc1683, 0xe3630b12, 0x94643b84,
	0x0d6d6a3e, 0x7a6a5aa8, 0xe40ecf0b, 0x9309ff9d, 0x0a00ae27, 0x7d079eb1,
	0xf00f9344, 0x8708a3d2, 0x1e01f268, 0x6906c2fe, 0xf762575d, 0x806567cb,
	0x196c3671, 0x6e6b06e7, 0xfed41b76, 0x89d32be0, 0x10da7a5a, 0x67dd4acc,
	0xf9b9df6f, 0x8ebeeff9, 0x17b7be43, 0x60b08ed5, 0xd6d6a3e8, 0xa1d1937e,
	0x38d8c2c4, 0x4fdff252, 0xd1bb67f1, 0xa6bc5767, 0x3fb506dd, 0x48b2364b,
	0xd80d2bda, 0xaf0a1b4c, 0x36034af6, 0x41047a60, 0xdf60efc3, 0xa867df55,
	0x316e8eef, 0x4669be79, 0xcb61b38c, 0xbc66831a, 0x256fd2a0, 0x5268e236,
	0xcc0c7795, 0xbb0b4703, 0x220216b9, 0x5505262f, 0xc5ba3bbe, 0xb2bd0b28,
	0x2bb45a92, 0x5cb36a04, 0xc2d7ffa7, 0xb5d0cf31, 0x2cd99e8b, 0x5bdeae1d,
	0x9b64c2b0, 0xec63f226, 0x756aa39c, 0x026d930a, 0x9c0906a9, 0xeb0e363f,
	0x72076785, 0x05005713, 0x95bf4a82, 0xe2b87a14, 0x7bb12bae, 0x0cb61b38,
	0x92d28e9b, 0xe5d5be0d, 0x7cdcefb7, 0x0bdbdf21, 0x86d3d2d4, 0xf1d4e242,
	0x68ddb3f8, 0x1fda836e, 0x81be16cd, 0xf6b9265b, 0x6fb077e1, 0x18b74777,
	0x88085ae6, 0xff0f6a70, 0x66063bca, 0x11010b5c, 0x8f659eff, 0xf862ae69,
	0x616bffd3, 0x166ccf45, 0xa00ae278, 0xd70dd2ee, 0x4e048354, 0x3903b3c2,
	0xa7672661, 0xd06016f7, 0x4969474d, 0x3e6e77db, 0xaed16a4a, 0xd9d65adc,
	0x40df0b66, 0x37d83bf0, 0xa9bcae53, 0xdebb9ec5, 0x47b2cf7f, 0x30b5ffe9,
	0xbdbdf21c, 0xcabac28a, 0x53b39330, 0x24b4a3a6, 0xbad03605, 0xcdd70693,
	0x54de5729, 0x23d967bf, 0xb3667a2e, 0xc4614ab8, 0x5d681b02, 0x2a6f2b94,
	0xb40bbe37, 0xc30c8ea1, 0x5a05df1b, 0x2d02ef8d
]

function str2bytes(str) {
	var bytes = new Array();
	var len, c;
	len = str.length;
	for (var i = 0; i < len; i++) {
		c = str.charCodeAt(i);
		if (c >= 0x010000 && c <= 0x10FFFF) {
			bytes.push(((c >> 18) & 0x07) | 0xF0);
			bytes.push(((c >> 12) & 0x3F) | 0x80);
			bytes.push(((c >> 6) & 0x3F) | 0x80);
			bytes.push((c & 0x3F) | 0x80);
		} else if (c >= 0x000800 && c <= 0x00FFFF) {
			bytes.push(((c >> 12) & 0x0F) | 0xE0);
			bytes.push(((c >> 6) & 0x3F) | 0x80);
			bytes.push((c & 0x3F) | 0x80);
		} else if (c >= 0x000080 && c <= 0x0007FF) {
			bytes.push(((c >> 6) & 0x1F) | 0xC0);
			bytes.push((c & 0x3F) | 0x80);
		} else {
			bytes.push(c & 0xFF);
		}
	}
	bytes.push(0x00);

	return bytes;
}

function bytes2str(arr) {
	if (typeof arr === 'string') {
		return arr;
	}
	var str = '',
		_arr = arr;
	for (var i = 0; i < _arr.length; i++) {
		var one = _arr[i].toString(2),
			v = one.match(/^1+?(?=0)/);
		if (v && one.length == 8) {
			var bytesLength = v[0].length;
			var store = _arr[i].toString(2).slice(7 - bytesLength);
			for (var st = 1; st < bytesLength; st++) {
				store += _arr[st + i].toString(2).slice(2);
			}
			str += String.fromCharCode(parseInt(store, 2));
			i += bytesLength - 1;
		} else {
			str += String.fromCharCode(_arr[i]);
		}
	}

	return str;
}

function nun2hex(num) {
	return (parseInt(num, 10) >>> 0).toString(16).toUpperCase();
}

function get_hex(num) {
	var str = (parseInt(num, 10) >>> 0).toString(16).toUpperCase();
	var rt = str.substring(str.length - 2, str.length);
	if (rt.length == 1)
		rt = '0' + rt;
	return rt
}

function get_hex_str(arr) {
	var single = "";
	for (var i = 0; i < arr.length; i++) {
		single += get_hex(arr[i]);
	}

	return single;
}

function time_str_to_time(time_str) {
	return {
		h: parseInt(time_str.split(":")[0], 10),
		m: parseInt(time_str.split(":")[1], 10)
	};
}

function ja_sort_by_key(array, key) {
	return array.sort(function (a, b) {
		var x = a[key];
		var y = b[key];
		return ((x < y) ? -1 : ((x > y) ? 1 : 0));
	});
}

function random_num(min, max) {
	switch (arguments.length) {
		case 1:
			return parseInt(Math.random() * min + 1, 10);
		case 2:
			return parseInt(Math.random() * (max - min + 1) + min, 10);
		default:
			return 0;
	}
}

function devid2mac(devid) {
	if (devid.length == 12) {
		return devid.slice(0, 2) + ':' + devid.slice(2, 4) + ':' + devid.slice(4, 6) + ':' + devid.slice(6, 8) + ':' +
			devid.slice(8, 10) + ':' + devid.slice(10, 12);
	}

	return '';
}

function crc16(buffer, is_cal_pkt, f_len) {
	let len = buffer.byteLength
	let genpoly = 0xA001
	let start_idx = 0
	let ret = 0xFFFF

	if (arguments.length != 0x1) {
		start_idx = 0x3
	}

	if (arguments.length == 3) {
		len = f_len
	}

	let dv = new DataView(buffer)
	for (let i = start_idx; i < len; i++) {
		ret = (ret ^ dv.getUint8(i)) & 0xFFFF;
		for (let index = 0; index < 8; index++) {
			if (ret & 0x0001) {
				ret = ((ret >> 1) & 0x7FFF) ^ genpoly;
			} else {
				ret = (ret >> 1) & 0x7FFF;
			}
			ret &= 0xFFFF;
		}
	}
	ret &= 0xFFFF;

	return ret;
}

function bytes2Hex(buffer) {
	if (!buffer) return '';

	// 处理 ArrayBuffer
	let bytes;
	if (buffer instanceof ArrayBuffer) {
		bytes = new Uint8Array(buffer);
	} else {
		bytes = buffer;
	}

	let hexStr = '';
	for (let i = 0; i < bytes.length; i++) {
		let hex = bytes[i].toString(16);
		if (hex.length === 1) {
			hex = '0' + hex;
		}
		hexStr += hex;
	}
	return hexStr.toUpperCase();
}

function crc32(buffer) {
	let tb_idx = 0
	let len = buffer.byteLength
	let dv = new DataView(buffer)
	let result_crc32_val = 0x33234236

	result_crc32_val ^= 0xFFFFFFFF
	for (let i = 0; i < len; i++) {
		result_crc32_val &= 0xFFFFFFFF
		tb_idx = ((result_crc32_val ^ dv.getUint8(i)) & 0xFF)
		result_crc32_val = (crc32_tab[tb_idx] ^ ((result_crc32_val >> 8) & 0x00FFFFFF))
	}
	result_crc32_val &= 0xFFFFFFFF
	result_crc32_val ^= 0xFFFFFFFF
	result_crc32_val &= 0xFFFFFFFF

	return result_crc32_val;
}

/**
 * 8位累加 + 取反 校验和
 * sum = (b0 + b1 + ... + bn) & 0xFF
 * checksum = (~sum) & 0xFF
 *
 * @param {ArrayBuffer | Uint8Array} bytes  每个元素 0~255
 * @returns {number} 0~255 的校验和
 */
function checksum8Invert(bytes) {
	let bufView = new Uint8Array(bytes);
	let sum = 0;
	for (let i = 0; i < bufView.length; i++) {
		sum = (sum + (bufView[i] & 0xFF)) & 0xFF; // 累加并保留 8 位
	}
	return (~sum) & 0xFF; // 按位取反并保留 8 位
}

function uint8array2str(fileData) {
	var dataString = "";
	for (var i = 0; i < fileData.length; i++) {
		dataString += String.fromCharCode(fileData[i]);
	}

	return dataString
}

function str2uint8array(str) {
	var arr = [];
	for (var i = 0, j = str.length; i < j; ++i) {
		arr.push(str.charCodeAt(i));
	}

	var tmpUint8Array = new Uint8Array(arr);
	return tmpUint8Array
}

const formatNumber = n => {
	n = n.toString()
	return n[1] ? n : '0' + n
}

function sec2datetime(number, format) {
	var formateArr = ['Y', 'M', 'D', 'h', 'm', 's'];
	var returnArr = [];

	var date = new Date(number * 1000);
	returnArr.push(date.getFullYear());
	returnArr.push(formatNumber(date.getMonth() + 1));
	returnArr.push(formatNumber(date.getDate()));

	returnArr.push(formatNumber(date.getHours()));
	returnArr.push(formatNumber(date.getMinutes()));
	returnArr.push(formatNumber(date.getSeconds()));

	for (var i in returnArr) {
		format = format.replace(formateArr[i], returnArr[i]);
	}
	return format;
}

/**
 * 拼接多个 ArrayBuffer 为一个 ArrayBuffer
 * @param {Array<ArrayBuffer>} buffers - 要拼接的 ArrayBuffer 数组
 * @returns {ArrayBuffer} - 拼接后的 ArrayBuffer
 */
function concatArrayBuffers(buffers) {
	// 计算总长度
	const totalLength = buffers.reduce((acc, buffer) => acc + buffer.byteLength, 0);

	// 创建新的ArrayBuffer和Uint8Array视图
	const result = new Uint8Array(totalLength);

	let offset = 0;
	buffers.forEach(buffer => {
		result.set(new Uint8Array(buffer), offset);
		offset += buffer.byteLength;
	});

	return result.buffer;
}

function getNowTimestamp() {
	return {
		//时间  4 字节：秒级 Unix 时间戳，例如 0x63841D2E (2022-11-28 10:30:06)
		timestamp: Math.floor(Date.now() / 1000),

		//时区   1 字节：如东八区 0x08 (UTC+8)，西十区 0xF6 (UTC-10)
		timezone: (-new Date().getTimezoneOffset() / 60) & 0xFF,
	};
}

function getTimestampMS(datetime) {
	return {
		//时间  4 字节：秒级 Unix 时间戳，例如 0x63841D2E (2022-11-28 10:30:06)
		timestamp: Math.floor(datetime / 1000),

		//时区   1 字节：如东八区 0x08 (UTC+8)，西十区 0xF6 (UTC-10)
		timezone: (-new Date().getTimezoneOffset() / 60) & 0xFF,
	};
}

export default {
	crc16: crc16,
	crc32: crc32,
	checksum: checksum8Invert,
	nun2hex: nun2hex,
	get_hex: get_hex,
	devid2mac: devid2mac,
	str2bytes: str2bytes,
	bytes2str: bytes2str,
	bytes2Hex: bytes2Hex,
	random_num: random_num,
	get_hex_str: get_hex_str,
	sec2datetime: sec2datetime,
	str2uint8array: str2uint8array,
	uint8array2str: uint8array2str,
	ja_sort_by_key: ja_sort_by_key,
	time_str_to_time: time_str_to_time,
	concatArrayBuffers: concatArrayBuffers,
	getNowTimestamp: getNowTimestamp,
	getTimestampMS: getTimestampMS,
};