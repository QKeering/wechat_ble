# RW V250 Addendum - 2026-07-17

## 閺堫剝鐤嗛惄顔界垼

缂佈呯敾閹稿鈧珐W 婢跺嫮鎮婃稉鍝勬嫲 L19 娑撯偓閼风补鈧繄娈戦惄顔界垼閹恒劏绻橀敍姘嚒鏉╃偤鈧氨娈戞＃鏍€?鐠囷附鍎忕仦鏇犮仛闁炬崘鐭炬穱婵囧瘮缁嬪啿鐣鹃敍宀勫櫢閻愮藟姒绘劕绨崇仦鍌涚梾閺堝绻戦崶鐐村灗濞屸剝婀佹潻娑樺弳娑撴艾濮熼弫鐗堝祦閻ㄥ嫬宕楃拋顔兼嚒娴犮們鈧倹婀版潪顔诲瘜鐟曚礁顦╅悶鍡曠秼濞撯晛鎳℃禒銈囧繁閸欙綇绱濋獮鍓佹埛缂侇厽鏁圭槐褏婀￠張鐑樻）韫囨ぜ鈧?
## 閺堚偓閺傜増妫╄箛妤冪波鐠?
- v249 閺冦儱绻旈柌?`vitalSigns` 瀹歌尙绮￠懗鎴掔瑐娴肩姴绺鹃悳鍥ф嫲鐞涒偓濮樠嶇窗`rawMetrics`/`submitMetrics` 閸у洤瀵橀崥?`heartRate=2`閵嗕梗spo2=2`閵?- 閸氬海顏拠锔藉剰閺屻儴顕楅柌灞藉嚒閼崇晫婀呴崚?`heartRate:62`閵嗕梗bloodOxygen:98`閿涘矁顕╅弰搴＄妇閻?鐞涒偓濮樠傜矤鎼存洖鐪伴崚棰佺瑐娴肩姴鍟€閸掓媽顕涢幆鍛淬€夐惃鍕瘜闁炬崘鐭惧鑼病闁哎鈧?- HRV閵嗕椒缍嬪〒鈹库偓浣稿竾閸?閹懐鍗庣粵澶嬬梾閺堝绻橀崗?`rawMetrics`閿涘苯缍嬮崜宥勭喘閸忓牆鍨介弬顓濊礋閳ユ粌绨崇仦鍌涙弓鏉╂柨娲栭幋鏍ㄦ弓闁插洭娉﹂崚鐗堟箒閺佸牆宸婚崣鑼额唶瑜版洍鈧繐绱濇稉宥嗘Ц閸楁洜鍑界拠锔藉剰妞ら潧鐫嶇粈鍝勭摟濞堢敻妫舵０妯糕偓?- APP SDK 缁鐖堕柌蹇曗€樼拋銈忕窗
  - `BLE_KEY_TEMPERATURE_DETECTING = 0x021b`
  - `BLE_KEY_TEMPERATURE_MONITORING = 0x027d`
  - `BLE_KEY_APP_REAL_TIME_TEMPERATURE_DATA = 0x0230`
  - `BLE_KEY_TEMPERATURE = 0x0508`

## V250 瀹稿弶鏁奸崝?
- 娴ｆ挻淇惄鎴炵ゴ閸愭瑥鍙嗛弨鍦暏 APP SDK 閻ㄥ嫭顥呭ù瀣磻閸?key `0x021b`閿涘矁顕伴崣鏍磧濞村鍘ょ純顔荤矝娣囨繄鏆€ `0x027d`閵?- RW monitoring parser 瀹歌尪鐦戦崚?`0x021b` 娑?`temperature`閿涘矂浼╅崗?ACK 閺冪姵纭惰ぐ鎺旇閵?- 鐎圭偞妞傞崑銉ユ倣鐠囪褰囩粵鏍殣鐠嬪啯鏆ｆ稉鐚寸窗娴兼ê鍘涚拠?APP realtime key閿涘苯鍟€閸ョ偤鈧偓鐠囪浠存惔宄板坊閸?key閿?  - 鐞涒偓濮樠嶇窗`0x024e` -> `0x0509`
  - HRV閿涙瓪0x0269` -> `0x050a`
  - 閸樺濮忛敍姝?x024f` -> `0x050d`
  - 鐞涒偓缁牭绱癭0x026c` -> `0x0510`
  - 鐞涒偓閸樺绱癭0x0231` -> `0x0504`
  - 娴ｆ挻淇敍姝?x0230` -> `0x0508`
- 閹存垹娈戞い鐢告桨閸楀繗顔呴幒銏ゆ嫛閺傛澘顤?`monitoring/temperature-detecting/write`閿涘瞼鏁ゆ禍搴ｆ埂閺堣櫣鈥樼拋?`0x021b` 閺勵垰鎯?ACK閵?- build tag 閺囧瓨鏌婃稉?`rw-visible-build-tag-20260718-262`閵?
## 娑撳绔存潪顔炬埂閺堟椽鍣搁悙?
1. 閸︺劉鈧粍鍨滈惃鍕ㄢ偓婵嬨€夌涵顔款吇 build tag 閺?`rw-visible-build-tag-20260718-262`閵?2. 鏉╃偞甯?SY03 閸氬氦绐囩€瑰本鏆ｉ懛顏咁梾閿涘矂鍣搁悙鍦箙閿?   - `monitoring/temperature-detecting/write` 閺勵垰鎯佹潻鏂挎礀 `rw_health_monitoring_ack:temperature`閵?   - 娴ｆ挻淇拠璇插絿閺勵垰鎯侀崙铏瑰箛 `0x0230` 閻?RX閿涘苯褰傞柅浣告姎鎼存柨瀵橀崥?`ab0100030cb4023010` 閹?`ab010003023010`閵?   - HRV/閸樺濮忛弰顖氭儊閸戣櫣骞?`0x0269`閵嗕梗0x024f` 閻?RX閵?3. 婵″倹鐏夋担鎾翠刊/HRV/閸樺濮忔禒宥嗘￥閺佺増宓侀敍宀€鎴风紒顓犳箙 `rawMetrics` 閺勵垰鎯佺紓鍝勵嚠鎼存柨鐡у▓鐐光偓鍌濆缂傚搫銇戦敍灞肩喘閸忓牊甯撴惔鏇炵湴闁插洭娉?鐠佹儳顦懗钘夊閿涙稖瀚㈤張澶娾偓闂寸稻妞ょ敻娼板▽鈩冩箒閿涘苯鍨幒鎺嶇瑐娴肩姾娴嗛幑銏″灗鐠囷附鍎忛幒銉ュ經鐎涙顔岄弰鐘茬殸閵?
## 瀹告煡鐛欑拠?
- `npm run verify:ring-ble` passed閵?- `npm run type-check` passed閵?- `npm run audit:rw-l19 -- --skip-dist` passed閵?- `npm run build:mp-weixin` passed閵?- `npm run verify:mp-weixin-artifact` passed閿涘奔瀵岄崠?`1255243` bytes閵?- `npm run check:mp-weixin-size` passed閿涘奔瀵岄崠鍛稇闁插繒瀹?`841909` bytes閵?- `npm run audit:rw-l19` passed閵?

