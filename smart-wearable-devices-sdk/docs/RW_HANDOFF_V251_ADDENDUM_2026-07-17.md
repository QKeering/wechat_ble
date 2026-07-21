# RW V251 Addendum - 2026-07-17

## 2026-07-17 15:08 log addendum

- Latest copied log was from the previous package, not this V251 package.
- The device connection path was healthy in that log: `connected=true`, `ready=true`, RW service and notify characteristic were present.
- The only foreground metric exercised in that log was `blood_sugar`.
- `blood_sugar/control-enable` returned `rw_health_data_control_ack` successfully, so the control channel was not the blocker for this sample.
- The follow-up realtime reads did not produce a valid value, and the health-history read returned an empty `rw_health_data_ack` for `0x0510`. Treat this as a bottom/protocol no-result case unless the next longer wait log shows a later value.
- V251 changes diagnostic timestamps from UTC-sliced time to local phone time. This removes the visible 8-hour diagnostic-log offset and makes future DB-time checks depend on `unix` / `futureSample` instead of copied-log display time.

## 閺堫剝鐤嗛惄顔界垼

缂佈呯敾閹恒劏绻?RW 娑?L19 娑撴艾濮熸稉鈧懛瀛樷偓褋鈧倸缍嬮崜宥嗙梾閺堝鏌婇惃鍕埂閺堝搫绨崇仦鍌涙）韫囨绱濋張顒冪枂閸欘亜顦╅悶鍡楀讲娴犲骸缍嬮崜宥勫敩閻線娼ら幀浣衡€樼拋銈囨畱闂傤噣顣介敍宀勪缉閸忓秵澧挎径褍宕楃拋顔芥暭閸斻劊鈧?
## V251 瀹稿弶鏁奸崝?
- 閳ユ粍鍨滈惃鍕ㄢ偓婵嬨€夐崣鍏呮櫠缁狀厼銇旀稉宥呭晙娓氭繆绂?`uv-icon arrow-right`閿涘本鏁兼稉?CSS 缂佹ê鍩楅敍宀勪缉閸忓秶婀￠張?瀵偓閸欐垼鈧懎浼愰崗铚傝厬鐎涙ぞ缍嬬紒鍕闁偓閸栨牗鍨?`&gt;` 閺傚洦婀伴妴?- 閸樺棗褰堕崥灞绢劄鐠囧﹥鏌囬幗妯款洣婢х偛濮為弮鍫曟？閹烘帗鐓＄€涙顔岄敍?  - `rawSample` / `submitSample` 閺嶉攱婀版晶鐐插 `unix`閿涘苯褰查惄瀛樺复閻鍩屾惔鏇炵湴閺冨爼妫块幋鐐解偓?  - 婢х偛濮?`filteredRecords`閵嗕梗futureFilteredRecords`閵嗕梗futureSample`閿涘瞼鏁ゆ禍搴″灲閺傤厽鏆熼幑顔肩氨閸戣櫣骞囬張顏呮降閺冨爼妫块弮璁圭礉閺勵垰绨崇仦鍌濐啎婢跺洦妞傞梻鏉戜焊缁変紮绱濇潻妯绘Ц娑撳﹣绱剁仦鍌濈箖濠?鏉烆剚宕查梻顕€顣介妴?- build tag 閺囧瓨鏌婃稉?`rw-visible-build-tag-20260718-262`閵?
## 娑撳绔存潪顔炬埂閺堟椽鍣搁悙?
1. 閸忓牏鈥樼拋銈傗偓婊勫灉閻ㄥ嫧鈧繈銆?build tag 閺?`rw-visible-build-tag-20260718-262`閿涘苯鑻熺涵顔款吇閼挎粌宕熼崣宕囶唲婢剁繝绗夐崘宥嗘▔缁€?`&gt;`閵?2. 缂佈呯敾鐠烘垵宸婚崣鎻掓倱濮濄儻绱濋柌宥囧仯閻?`diagnostic-history-report`閿?   - `rawSample[].unix` 娑?`rawSample[].t` 閺勵垰鎯侀張顒冮煩瀹稿弶妲搁張顏呮降閺冨爼妫块妴?   - `futureFilteredRecords` 閺勵垰鎯佹径褌绨?0閵?   - 婵″倹鐏?`rawSample` 濮濓絽鐖舵担?`submitSample` 閸欐ɑ婀弶銉︽闂傝揪绱濋幒鎺嶇瑐娴肩姾娴嗛幑顫幢婵″倹鐏?`rawSample` 瀹稿弶婀弶銉礉閹烘帟顔曟径鍥ㄦ闁?妫板嫬鎮撳銉ｂ偓?3. 娴ｆ挻淇妴涓燫V閵嗕礁甯囬崝娑楃矝閹?v250 閻ㄥ嫬绨崇仦鍌濈熅缁惧潡鐛欑拠渚婄窗娴兼ê鍘涢惇?`0x0230`閵嗕梗0x0269`閵嗕梗0x024f` 閺勵垰鎯侀張澶嬫箒閺?RX閵?
