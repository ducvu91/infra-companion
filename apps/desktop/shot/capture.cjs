// Chụp harness bằng Electron — máy này không có rasterizer nào khác.
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: { offscreen: true },
  })
  win.webContents.on('console-message', (_e, _lvl, msg) => console.log('CONSOLE:', msg))
  await win.loadFile(path.join(__dirname, 'index.html'))
  await new Promise((r) => setTimeout(r, 1500))
  const img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(__dirname, 'shot.png'), img.toPNG())
  console.log('OK')
  app.quit()
})
