import { chromium } from 'playwright';

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36" fill="black">
  <path d="M4 4l7.07 15.021a1 1 0 0 0 1.838-.137l1.789-5.367 5.368-1.789a1 1 0 0 0 .136-1.838L5.181 2.85A1 1 0 0 0 4 4z"/>
</svg>
`;

const html = `<html><body style="margin:0;padding:0;background:transparent;display:flex;justify-content:center;align-items:center;width:36px;height:36px;">${svg}</body></html>`;

const svg18 = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="black">
  <path d="M4 4l7.07 15.021a1 1 0 0 0 1.838-.137l1.789-5.367 5.368-1.789a1 1 0 0 0 .136-1.838L5.181 2.85A1 1 0 0 0 4 4z"/>
</svg>
`;

const html18 = `<html><body style="margin:0;padding:0;background:transparent;display:flex;justify-content:center;align-items:center;width:18px;height:18px;">${svg18}</body></html>`;


(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 36, height: 36 } });
    await page.setContent(html);
    const body = await page.$('body');
    await body.screenshot({ path: 'build/trayTemplate@2x.png', omitBackground: true });
    
    await page.setViewportSize({ width: 18, height: 18 });
    await page.setContent(html18);
    const body18 = await page.$('body');
    await body18.screenshot({ path: 'build/trayTemplate.png', omitBackground: true });
    
    console.log('Icons generated successfully.');
  } finally {
    await browser.close();
  }
})();
