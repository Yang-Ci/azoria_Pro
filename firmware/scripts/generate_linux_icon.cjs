// Render the repository's Linux SVG directly at its native Touch display size.
// Store alpha coverage only; LVGL supplies the selected/unselected tint.
const { readFileSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const { Resvg } = require('@resvg/resvg-js')

const root = path.resolve(__dirname, '..')
const svg = readFileSync(path.join(root, 'assets/icons/linux.svg'), 'utf8')
const image = new Resvg(svg, { fitTo: { mode: 'width', value: 40 } }).render()
if (image.width !== 40 || image.height !== 40) throw new Error('Expected a square 40 px Linux icon')
const pixels = image.pixels
const alpha = Array.from({ length: 1600 }, (_, index) => pixels[index * 4 + 3])
const rows = []
for (let index = 0; index < alpha.length; index += 16) rows.push('    ' + alpha.slice(index, index + 16).join(', ') + ',')
const array = '/* Generated from assets/icons/linux.svg by scripts/generate_linux_icon.cjs. */\n' +
  'static const uint8_t icon_linux_40_data[] = {\n' + rows.join('\n') + '\n};'
const descriptor = `const lv_img_dsc_t icon_linux_40 = {
    .header = {
        .cf = LV_IMG_CF_ALPHA_8BIT,
        .always_zero = 0,
        .reserved = 0,
        .w = 40,
        .h = 40,
    },
    .data_size = sizeof(icon_linux_40_data),
    .data = icon_linux_40_data,
};`
const file = path.join(root, 'src/ui/assets/icons.c')
let source = readFileSync(file, 'utf8')
const arrayPattern = /(?:\/\* Generated from assets\/icons\/linux\.svg[^\n]*\*\/\r?\n)?static const uint8_t icon_linux_(?:36|40)_data\[\] = \{[\s\S]*?\r?\n\};/
const descriptorPattern = /const lv_img_dsc_t icon_linux_(?:36|40) = \{[\s\S]*?\r?\n\};/
if (!arrayPattern.test(source) || !descriptorPattern.test(source)) throw new Error('Linux asset blocks were not found')
source = source.replace(arrayPattern, array).replace(descriptorPattern, descriptor)
writeFileSync(file, source)
console.log('Generated native 40x40 Linux alpha asset from SVG.')
