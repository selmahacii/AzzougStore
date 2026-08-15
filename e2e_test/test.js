const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[REACT]') || text.includes('[PIXEL]') || text.includes('[STORE-INTEGRATION]') || text.includes('[TRACK-META-EVENT]')) {
      console.log(text);
    }
  });
  // Navigate and don't wait for load
  try {
    await page.goto('http://localhost:3016/test-slug', { waitUntil: 'domcontentloaded', timeout: 10000 });
  } catch (e) {
    console.log('Goto timed out but continuing to wait for scripts...');
  }
  // Wait an extra few seconds for React hydration and logs
  await page.waitForTimeout(5000);
  await browser.close();
})();
