const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  page.on('request', req => {
    if (req.url().includes('facebook.com')) {
      const url = new URL(req.url());
      const ev = url.searchParams.get('ev');
      const eid = url.searchParams.get('eid');
      console.log(`[NETWORK] ${req.method()} ${req.url()}`);
      if (ev) {
        console.log(`[PIXEL-NETWORK] Event: ${ev}, eventID (eid): ${eid}`);
      }
    }
  });

  page.on('console', msg => {
    console.log(`[CONSOLE] ${msg.text()}`);
  });
  
  console.log('--- FIRST LOAD ---');
  await page.goto('http://localhost:3016/test-slug', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  
  console.log('--- CLIENT-SIDE NAVIGATION ---');
  // Navigate to another product page to trigger client-side navigation
  await page.evaluate(() => {
    // Next.js router navigation
    window.next.router.push('/test-slug?product=something-else');
  });
  await page.waitForTimeout(4000);
  
  await browser.close();
})();
