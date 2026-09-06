const { readFileSync, mkdirSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const { Resvg } = require('@resvg/resvg-js')

const assets = path.resolve(__dirname, '../desktop/assets')
const svg = readFileSync(path.join(assets, 'icon.svg'), 'utf8')
mkdirSync(path.join(assets, 'icons'), { recursive: true })
for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
  writeFileSync(path.join(assets, 'icons', `${size}x${size}.png`), png)
  if (size === 512) writeFileSync(path.join(assets, 'icon.png'), png)
}
console.log('Generated AZORIA application icons (16–1024 px).')
