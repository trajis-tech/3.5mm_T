FTWS Line — Android GMSK 修正版
================================

入口：LINE.html

這版針對「手機系統錄音聽得到，但 Android Chrome / Quiet 收不到」重做接收路徑。

主要修改
--------
1. Modem：FSK8 改為 GMSK（Android Chrome Quiet.js Receiver 相容路徑）。
2. Profile：10 samples/symbol、CRC32，故意不使用 v27/RS FEC，避免離線包缺少 libfec.js 而初始化失敗。
3. 傳檔：chunk 由 8 B 提升到 128 B；一般 DATA 由每塊 3 次改成 1 次。
4. START 重複 3 次、END 重複 2 次，降低控制封包遺失風險。
5. 缺失補傳：手機可複製缺失 chunk；電腦貼到「補傳缺失」後只重送那些 chunk。
6. 接收端可列出 audioinput，並可指定輸入裝置。
7. 新增輸入電平計：先確認 Chrome 本身真的收到線材訊號，再判斷 Quiet 解碼。
8. Android 自動模式預設採「路由優先」：AEC 開啟、NS/AGC 關閉，用來避開部分 Chromium 版本在關閉 AEC 時強制改抓內建麥克風的問題。
9. 仍提供「原始音訊」模式；若你的 Chrome 已包含路由修正，可測試原始模式是否更穩。

建議測試順序
------------
1. 電腦 Chrome 開 LINE.html →「電腦傳送」→「探測音」。
2. 手機先用系統錄音確認線材有聲。
3. 手機 Chrome 開 LINE.html →「手機接收」。
4. 收音模式保持「自動（Android 路由優先）」。
5. 按「重新掃描輸入」，有外接/耳機類輸入時優先選它；若只有「系統預設」也可先測。
6. 按「開始接收」。
7. 電腦播放探測音或傳 Demo 時，手機頁面的「輸入電平」必須明顯上升。
   - 幾乎無訊號：Chrome 還沒走到線路輸入。
   - 過載 / clipping：降低電腦耳機輸出音量。
   - 有電平但不解碼：再測原始音訊模式、調整輸出音量。
8. Demo 成功後再傳檔。
9. 若傳完仍缺 chunk：手機按「複製缺失」，把文字貼到電腦「補傳缺失」欄，按「只補傳缺失」。

注意
----
- Chrome 麥克風權限通常要求 HTTPS；file:// 在手機上常無法正常 getUserMedia。建議使用 HTTPS / GitHub Pages / 本機 HTTPS 伺服器。
- iPhone / Safari 不支援 Quiet.js 麥克風接收。
- 3.5mm 耳機輸出直接餵手機麥克風腳位可能電平過高；以頁面 clipping 指示為準調低音量。
- Android「路由優先」會保留 AEC 以換取較可靠的外接輸入路由，因此若已確認新版 Chrome 能在 raw 模式走外接輸入，raw 模式理論上更適合 modem tone。
