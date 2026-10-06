# AZORIA Touch 独立外壳（V3 紧固版 + 双支架）

适配 VIEWE `UEDX48480040E-WB-A V1.3` 4 英寸 480×480 模组。设计基准为厂家
V3.2 规格书中的 94×94 mm PCBA、84×84 mm 玻璃盖板、87×87 mm 安装孔中心距和
约 8.33 mm 最大组件深度。

V3 针对 V2 实物反馈做了三项修正：PCB 内腔由 95.2 mm 收紧到 94.5 mm；后盖压垫由
2.2 mm 加高到 2.55 mm，并加强四边摩擦筋；两个 USB-C 开孔按厂家背视图重新定位，
并处理了后盖翻面安装产生的左右镜像。

2026-10-04 根据实物反馈修正 USB-C 开口：去掉两个缺口之间的隔条，合并为连续开口，
并沿 PCB 上边到下边的方向整体下移 4 mm。单独后盖和全套单盘 STL 均已同步。

## V3 文件

- [azoria-touch-all-v3.stl](azoria-touch-all-v3.stl)：前壳、后盖和两种支架的单盘文件。
- [azoria-touch-front-v3.stl](azoria-touch-front-v3.stl)：99.3×99.3×15.5 mm 前框与壳体。
- [azoria-touch-rear-v3.stl](azoria-touch-rear-v3.stl)：紧配后盖，带下移 4 mm 的连续双 USB-C 开口。
- [azoria-touch-stand-dock-v3.stl](azoria-touch-stand-dock-v3.stl)：参考图样式的一体式底座，10° 后仰、斜背板、前挡边及
  两侧加强筋。
- [azoria-touch-stand-frame-v3.stl](azoria-touch-stand-frame-v3.stl)：三角框架式背撑，15° 后仰，底面更宽、抗侧翻更强。

本目录保留以上 5 个 V3 STL 和本说明，是独立屏幕外壳。
桌面充电站使用旁边的 [charging-station-v2](../charging-station-v2/README.md)，
其屏幕后盖已同步本目录 2026-10-04 的 USB 开口修正。
全套单盘文件已经包含四个独立打印件，选择整套打印或按需单独打印即可。

## 建议验证顺序

1. 打印前壳，确认 PCB 四角能顺畅进入但没有明显横向晃动；内腔为 94.5×94.5 mm。
   所有文件保持 100% 缩放，装板核对四孔和接口位置后再完成装配。
2. 在四个后盖环形压垫上贴 0.2 mm 薄泡棉。泡棉负责预压和吸收打印误差，避免硬塑料直接
   顶压 PCB。
3. 从背面装入模组，然后安装后盖。从成品背面看，连续 USB 开口应位于右侧上半区，覆盖
   两个 Type-C 口。后盖 STL 以内部结构朝上建模，所以打印预览中缺口会出现在左侧，
   翻面装入后才是正确的背视图右侧。
4. 两种支架可以都打印：`stand-dock` 外形简洁；`stand-frame` 占用材料更多，但碰触屏幕时
   更稳。

## FDM 参数

- 材料：首版 PLA；长期高温环境或需要卡扣韧性时用 PETG。
- 喷嘴：0.4 mm；层高：0.20 mm；壁线：4 道；顶/底层：4–5 层；填充：20–25%。
- 前框：显示面朝下，建议启用 0.15–0.25 mm 象脚补偿。
- 后盖：大平面朝下、压垫朝上；无需支撑。
- 一体式底座：宽底面直接朝下；无需支撑，建议 20–30% 填充。
- 三角框架：STL 已让三角侧面朝下；不要自动旋转，打印高度为 60 mm，无需支撑。
- 所有 STL 单位均为毫米，缩放保持 100%。

## USB 定位

原始设计的两个 USB-C 中心距 PCB 上边分别为 17.33 mm 和 31.72 mm。根据本次实物反馈，
开口整体下移 4 mm，将中心参考位置修正为 21.33 mm 和 35.72 mm；
这是开口的装配修正，不是新的厂家接口标称尺寸。两个 11 mm 宽缺口及中间 3.39 mm
隔条合并为沿边长 25.39 mm 的连续开口，深度参数仍为 11.5 mm（原有切削余量不变）。
开口上、下边距 PCB 上边分别为 15.83 mm 和 41.22 mm。向下指模型的 -Y 方向，
不是盖板厚度方向。实际插头配合仍需装板确认。

## 机械资料

- [厂家 V3.2 规格书](https://github.com/VIEWESMART/UEDX48480040ESP32-4inch-Touch-Display/blob/main/information/UEDX48480040E-WB-A%20V3.2%20SPEC.pdf)
- [厂家硬件仓库](https://github.com/VIEWESMART/UEDX48480040ESP32-4inch-Touch-Display)
