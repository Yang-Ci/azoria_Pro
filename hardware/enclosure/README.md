# AZORIA Touch 独立外壳（V3 紧固版 + 双支架）

适配 VIEWE `UEDX48480040E-WB-A V1.3` 4 英寸 480×480 模组。设计基准为厂家
V3.2 规格书中的 94×94 mm PCBA、84×84 mm 玻璃盖板、87×87 mm 安装孔中心距和
约 8.33 mm 最大组件深度。

V3 针对 V2 实物反馈做了三项修正：PCB 内腔由 95.2 mm 收紧到 94.5 mm；后盖压垫由
2.2 mm 加高到 2.55 mm，并加强四边摩擦筋；两个 USB-C 开孔按厂家背视图重新定位，
并处理了后盖翻面安装产生的左右镜像。

## V3 文件

- `azoria-touch-case.scad`：参数化源文件。
- `azoria-touch-front-v3.stl`：99.3×99.3×15.5 mm 前框与壳体。
- `azoria-touch-rear-v3.stl`：紧配后盖，带两个独立 USB-C 缺口。
- `azoria-touch-layout-v3.stl`：前壳和后盖的组合打印布局。
- `azoria-touch-all-v3.stl`：前壳、后盖和两种支架的单盘文件，不包含试装片。
- `azoria-touch-fit-test-only-v3.stl`：94.5 mm 内腔与 87 mm 四孔试装片，不参与最终装配。
- `azoria-touch-stand-dock-v3.stl`：参考图样式的一体式底座，10° 后仰、斜背板、前挡边及
  两侧加强筋。
- `azoria-touch-stand-frame-v3.stl`：三角框架式背撑，15° 后仰，底面更宽、抗侧翻更强。

V1 STL 保留为历史版本；有实物问题的 V2 STL 已删除，新打印请只使用带 `v3` 的文件。

## 建议验证顺序

1. 先打印 `azoria-touch-fit-test-only-v3.stl`，确认 PCB 四角能顺畅进入但没有明显横向晃动，
   并核对四个安装孔。
2. 合适后分别打印 `front-v3` 和 `rear-v3`。若试片仍偏紧，把 `xy_clearance` 从 `0.25`
   增至 `0.30`；若仍偏松，降至 `0.20`，不要使用切片软件整体缩放来补偿。
3. 在四个后盖环形压垫上贴 0.2 mm 薄泡棉。泡棉负责预压和吸收打印误差，避免硬塑料直接
   顶压 PCB。
4. 从背面装入模组，然后安装后盖。从成品背面看，两个 USB 缺口应位于右侧上半区，分别
   对准两个 Type-C 口。后盖 STL 以内部结构朝上建模，所以打印预览中缺口会出现在左侧，
   翻面装入后才是正确的背视图右侧。
5. 两种支架可以都打印：`stand-dock` 外形简洁；`stand-frame` 占用材料更多，但碰触屏幕时
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

厂家机械图给出的两个 USB-C 中心距 PCB 上边分别为 17.33 mm 和 31.72 mm。V3 使用两个
11×11.5 mm 独立边缘缺口，不再使用 V2 的 42×15 mm 连续大缺口，因此后盖保留了更多
材料。若实际板卡修订版将 USB 移到另一侧，只需把 SCAD 中
`usb_installed_back_view_side` 从 `1` 改为 `-1` 后重新导出后盖。

## 机械资料

- [厂家 V3.2 规格书](https://github.com/VIEWESMART/UEDX48480040ESP32-4inch-Touch-Display/blob/main/information/UEDX48480040E-WB-A%20V3.2%20SPEC.pdf)
- [厂家硬件仓库](https://github.com/VIEWESMART/UEDX48480040ESP32-4inch-Touch-Display)
