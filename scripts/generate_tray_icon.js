import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const assetsDir = 'electron/assets';
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// macOS tray icons should be roughly 18x18 inside a 22x22 box, 
// or 16x16 inside a 22x22 box.
// We'll use a 22x22 target size to match native expectations.

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="black">
  <path d="M5.5 3.5l6.5 13.5 1.5-4.5 4.5-1.5z"/>
  <path d="M5.5 3.5l6.5 13.5 1.8-5.4 5.4-1.8z" opacity="1"/>
</svg>
`;

// Simple Cursor path for a 24x24 viewbox, mapped to 22x22
const cursorSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="black">
  <path d="M4.5 3.5v13.06l3.78-3.79 2.51 5.73 2.13-0.93-2.47-5.63 5.05-0.12z"/>
</svg>
`;

const html = (svg) => `<html><body style="margin:0;padding:0;background:transparent;display:flex;justify-content:center;align-items:center;width:22px;height:22px;">${svg}</body></html>`;

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 22, height: 22 }, deviceScaleFactor: 2 });
    
    // Generate 2x version (@2x)
    await page.setContent(html(cursorSvg));
    const body = await page.$('body');
    await body.screenshot({ path: path.join(assetsDir, 'trayTemplate@2x.png'), omitBackground: true });
    
    // Generate 1x version
    const page1x = await browser.newPage({ viewport: { width: 22, height: 22 }, deviceScaleFactor: 1 });
    await page1x.setContent(html(cursorSvg));
    const body1x = await page1x.$('body');
    await body1x.screenshot({ path: path.join(assetsDir, 'trayTemplate.png'), omitBackground: true });
    
    console.log('Icons generated successfully in electron/assets/');
  } finally {
    await browser.close();
  }
})();
