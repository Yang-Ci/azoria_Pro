# AZORIA Touch 独立外壳（V2 实物修正版）

适配 VIEWE `UEDX48480040E-WB-A V1.3` 4 英寸 480×480 模组。设计依据是厂家
V3.2 规格书中的 94×94 mm PCBA、84×84 mm 玻璃盖板、87×87 mm 安装孔中心距
和约 8.33 mm 最大组件深度。

V2 根据第一件实物试装结果修正：PCB 安装孔位置保持不变；内部 PCB 腔改为直角，并把
单边装配余量由 0.35 mm 增加到 0.60 mm；背盖右侧增加覆盖两个 USB-C 接口的连续缺口。
左右侧壁仍采用宽开口，兼容 TF 卡槽、按键和接口的小幅版本差异。

## 文件

- `azoria-touch-case.scad`：参数化源文件；顶部 `part` 可选择导出的零件。
- `azoria-touch-front-v2.stl`：V2 前框与壳体，直角 PCB 腔。
- `azoria-touch-rear-v2.stl`：V2 通风压盖，右侧带双 USB-C 连续缺口。
- `azoria-touch-layout-v2.stl`：上面两个正式零件的组合打印布局。
- `azoria-touch-fit-test-only-v2.stl`：仅用于快速检查直角板边和四孔，**不是中框，
  不参与最终装配，也不会嵌入前壳**。

最终外壳只有两个打印件：`front-v2` 和 `rear-v2`。PCB/屏幕直接从前壳背面装入，
再扣上后盖。

## 推荐顺序

1. 若想先做最小成本验证，只打印 `azoria-touch-fit-test-only-v2.stl`，确认 PCB 的四个
   直角都能无压力进入，再核对四孔；检查后把试片取下，不要放进正式外壳。
2. V2 默认单边留 0.60 mm（总间隙 1.20 mm）。若仍过紧，把 SCAD 中
   `xy_clearance` 增加到 `0.75`；若明显晃动，减到 `0.45`。
3. 试片通过后分别打印 `front-v2` 和 `rear-v2`。
4. 在玻璃边缘与前框之间贴 0.2–0.5 mm 的薄泡棉或 Kapton 胶带，避免硬塑料直接压玻璃。
5. 从背面装入模组，确认两个 USB-C 位于背盖连续缺口一侧，再压入背盖。若背盖过紧，
   轻磨四条摩擦筋；若模组前后晃动，增加 `pad_height` 或在四个环形压垫上贴薄泡棉。

## FDM 参数

- 材料：首版 PLA；长期放在高温机箱旁建议 PETG。
- 喷嘴：0.4 mm。
- 层高：0.20 mm。
- 壁线：3–4 道。
- 顶/底层：4 层。
- 填充：15–25%。
- 支撑：不需要。
- 前框：显示面朝下打印；建议启用 0.15–0.25 mm 象脚补偿。
- 背盖：平面朝下、压垫朝上打印。

完整外壳约为 100×100×15.5 mm，PCB 内腔 95.2×95.2 mm，正面开窗 82×82 mm。
背盖 USB 缺口约 15 mm 深、42 mm 长。切片前确认 STL 单位为毫米。

### Bambu Studio / A1

1. 在 Windows 的 Bambu Studio 中先导入 `azoria-touch-fit-test-only-v2.stl`，单位选择毫米，
   缩放保持 `100%`。
2. 使用 A1 的 `0.20 mm Standard` 起始配置、普通 PLA、关闭支撑；首层不要使用会改变
   XY 尺寸的额外缩放。
3. 试片确认后，导入 `azoria-touch-front-v2.stl` 和 `azoria-touch-rear-v2.stl` 分开切片
   最稳妥；也可以使用已经排好的 `azoria-touch-layout-v2.stl`。
4. 前框保持显示面朝下，背盖保持大平面朝下。切片预览中确认七条散热槽均贯通。

## 机械资料

- [厂家规格书](https://github.com/VIEWESMART/UEDX48480040ESP32-4inch-Touch-Display/blob/main/information/UEDX48480040E-WB-A%20V3.2%20SPEC.pdf)
- [厂家硬件仓库](https://github.com/VIEWESMART/UEDX48480040ESP32-4inch-Touch-Display)
