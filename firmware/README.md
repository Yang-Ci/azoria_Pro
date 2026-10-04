# Firmware

AZORIA Touch 的 ESP32-S3 + LVGL 固件，提供亮度、音量、静音、输入源控制和壁纸模式。

Desktop 的 Touch 设置支持顺时针 90° 循环旋转，通过 Wi-Fi / BLE 下发保存的方向。
固件同步转换显示画面与触摸坐标，静态和动态壁纸沿用相同方向。LVGL 使用独立的
逻辑绘制缓冲，旋转脏区域后复制到两个 LCD 扫描缓冲，并在 VSYNC 后同步空闲缓冲。

## 构建

AI 协作、备份、OTA 槽位核验和 Windows 烧录命令见根目录
[构建、更新与烧录要求](../README.zh-CN.md#ai-协作构建更新与烧录要求)。
存量设备默认只升级已确认会启动的应用槽，保留配对、Wi-Fi 和壁纸。

```bash
pio run -e viewe_uedx48480040e_wb_a
pio device monitor --port /dev/cu.usbmodemXXXX --baud 115200
```

应用固件输出到 `.pio/build/viewe_uedx48480040e_wb_a/firmware.bin`。

首刷或用户明确要求完整恢复时，才核对目标端口后使用
`pio run -e viewe_uedx48480040e_wb_a -t upload --upload-port <实际端口>`；
该命令可能同时写入启动程序和分区表，不能当作存量设备的默认应用升级命令。

手动调用 esptool 刷入应用时，显式使用
`--flash-mode keep --flash-freq keep --flash-size keep` 保留已有参数。
当前 ESP32-S3 启动镜像使用 DIO，不能按 `board_build.flash_mode = qio` 强制改写
启动镜像头，否则会在 ROM 加载阶段反复重启。烧录前仍需核对实机分区表及 OTA 槽位，
不能仅根据构建配置决定写入偏移或启动参数。
说明见 [Espressif 启动模式文档](https://docs.espressif.com/projects/esptool/en/latest/esp32s3/advanced-topics/boot-mode-selection.html)。

## 目录

- `assets/icons/`：生成 LVGL 图标所使用的 SVG 源文件；
- `include/`：VIEWE 板卡配置；
- `src/features/display_control/`：显示器控制状态、命令与触控界面；
- `src/platform/`：LCD、背光和触摸硬件适配；
- `src/services/`：USB 配网、BLE 传输和本机配置；
- `src/ui/`：公共 LVGL 组件、字体和生成后的图标数据。

普通用户使用已预装固件的设备，在 AZORIA Desktop 的“AZORIA Touch”页完成
2.4 GHz Wi‑Fi 配网。开发者需要刷写或恢复固件时，先在桌面端设置中开启
“开发者模式”。BLE OTA 会校验固件大小与 SHA-256 后再重启。

连入 Wi‑Fi 后，Touch 在 UDP 8733 被动等待同一私网内的 Desktop 发现请求，随后接收
Desktop 地址和控制端口。控制操作广播到 UDP 8734，由当前具备 DDC/CI 执行能力的
Desktop Master 消费并在 UDP 8733 返回结果。Master 在连接正常期间保持不变，只有断线、
DDC/CI 路径失效或执行失败时才重新选择。Touch 会用相同命令 ID 重试未确认的最终操作，
Desktop 返回缓存结果以避免重复写入。Touch 不主动扫描局域网主机，也不会连接公网地址。

底部控制源区域一次显示四个方块，可横向滑动查看第 5 个 `PANEL` 内屏目标。选择内屏后，
亮度改为控制笔记本内屏，音量和静音继续控制系统默认音频设备；选择外接输入源会切回
外接显示器并发送对应的 DDC/CI 输入切换命令。

壁纸由 Desktop 转换为 `AZW1` JPEG 帧包，经 TCP `8732` 下载到存储设备。固件会校验
包大小、帧结构和 SHA-256 后再启用。点击主界面 Music 字标下方的电脑图标可立即进入；
Desktop 可将无操作自动进入时间设为 1、5、10、30 分钟或关闭，设置会同步并保存在
Touch 上；触摸壁纸返回控制界面。插入 TF 卡时优先使用 TF 卡，未插卡时回退到板载
`spiffs` 数据分区（LittleFS 文件系统）。
局域网协议不做身份认证，应仅在可信局域网中使用。

主界面保留原有入口布局；左上角的 Music 字标使用 38 px 连笔字体。
Linux 图标从 SVG 直接生成原生 40 px 图像，使用 `node scripts/generate_linux_icon.cjs`
（在 firmware 目录）重新生成，避免放大较小的位图。
普通音乐页与沉浸式歌词页均可从顶部向下滑出系统音量面板，向上滑动或点击 × 收起；
音量调节沿用控制页的预览节流、最终值提交和状态同步，拖动不会退出沉浸式歌词。
背光与音乐音量浮层使用相同的细刻度、醒目数值、圆形滑块和收起把手布局；
背光使用暖金色，音乐音量跟随封面主题色。
背光浮层标注“Touch 屏幕亮度”，与首页的显示器亮度区分。
浮层以短距离滑入和淡入展开，滑块按下时轻微放大，离开音乐页会取消浮层动效。
字标字体来源和生成命令见 `assets/fonts/README.md`。

音乐界面字体由 `DroidSansFallbackFull` 中文字体、Noto Sans 拉丁扩展字体和 LVGL
Montserrat 后备字体组成。`azoria_font_latin_16.c` 与 `azoria_font_latin_28.c` 覆盖
`U+00A0–U+024F`，用于罗马尼亚语等含重音字符的歌词；生成参数记录在各字体源文件头部。

主界面顶部的 `Codex / API` 打开额度仪表：采用精密刻度布局，主额度使用青绿刻度、
第二周期使用淡紫色条形刻度。套餐文字显示在顶部 CODEX 标题右侧。
周期标题使用“5 小时额度”“周额度”等名称；周额度数字左侧同一行显示
“周额度 / 重置倒计时”，右下角显示同步时间。主额度的 100% 和小数使用紧凑字号
并保持垂直居中，避免碰到圆弧刻度。
识别到 Codex Pro 套餐后自动使用黑金周额度仪表：金色细刻度和居中的大数字显示
周额度，下方显示重置倒计时，顶部显示 PRO 铭牌。按周期长度识别实际周窗口，
不显示五小时窗口；缺少周窗口时显示等待额度数据。Plus 沿用青绿和淡紫色的原版仪表。
打开额度页时刻度依次点亮一次；额度变化时刻度平滑增减，数字立即显示真实值。
按钮带轻微提亮反馈，切页使用短距离滑入和淡入，完整余额弹窗淡入并轻微上移。
动效结束后保持静止，离开额度页会停止动效；空数据和已结束周期不播放额度动画。
底部按钮或左右滑动切换 Codex / API 两页，点击返回箭头回到首页。
API 页隐藏服务名称，显示账户序号，点击账户余额
标题循环切换桌面端已配置的账户。余额自动缩写为万 / 亿，点击余额查看完整金额。
Touch 每 15 秒获取桌面缓存；桌面在后台检查 Codex 额度并按服务刷新间隔查询 API，
无需一直打开桌面额度标签。支持 Wi-Fi 和分页蓝牙同步，API 查询凭据只保存在电脑。
离线、暂停、查询失败和过期采样会保留或标明已有数据，重置后等待下一次真实采样。

可使用 `python scripts/preview_usage.py`（在 firmware 目录，需要 GCC/G++ 和 Pillow）
渲染实际 LVGL 页面并验证额度边界、小数、空状态、隐藏服务名称、切页、完整金额、
切账户、离线及周期结束交互。USB 调试
命令 `AZORIA_USAGE 0` / `AZORIA_USAGE 1` 打开对应页，配合 `AZORIA_SCREENSHOT` 抓图。

当前硬件验证：VIEWE UEDX48480040E-WB-A V1.3、480×480 GC9503、FT6336U、16MB
Flash 和 8MB PSRAM。

背部方形 D3 是 WS2812B RGB 状态灯。启动时以低亮度绿光亮 150 ms，随后熄灭。
它与 TF 卡 MOSI 共用 GPIO42；固件在 TF 初始化和壁纸读写结束、SPI 空闲时发送
熄灯数据。初始化重试先释放总线，再重新配置引脚；挂载失败后释放 SPI 并用 RGB
驱动再次灭灯，保持 GPIO42 为低电平。D5 是硬接 3.3V 的供电指示灯，
无法通过固件控制。硬件接线见 [VIEWE V1.3 原理图](https://github.com/VIEWESMART/UEDX48480040ESP32-4inch-Touch-Display/blob/main/Schematic/UEDX48480040E-WB-A%20V1.3.SCH_00.png)。

代码遵循根目录 GPL-3.0-or-later；板卡、显示器、平台标识和第三方组件仍受各自许可约束。
