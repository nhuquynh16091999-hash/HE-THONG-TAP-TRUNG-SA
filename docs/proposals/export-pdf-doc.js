const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--font-render-hinting=none', '--force-color-profile=srgb'],
  });
  const page = await browser.newPage();

  await page.setViewport({ width: 800, height: 1000 });
  await page.emulateMediaType('screen');

  await page.goto('http://localhost:8899/levelup-corelev-eu-proposal-doc.html', {
    waitUntil: 'networkidle0',
    timeout: 30000,
  });

  await page.evaluateHandle('document.fonts.ready');
  await new Promise(r => setTimeout(r, 3000));

  await page.pdf({
    path: 'c:/Users/Admin/Desktop/Agentic-AI-Levelup/docs/proposals/levelup-corelev-eu-proposal-partner.pdf',
    format: 'A4',
    printBackground: true,
    margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
    displayHeaderFooter: true,
    headerTemplate: '<div style="font-size:7pt;color:#999;width:100%;text-align:right;padding-right:16mm;font-family:sans-serif;">Level Up × Corele V. — EU Proposal</div>',
    footerTemplate: '<div style="font-size:7pt;color:#999;width:100%;text-align:center;font-family:sans-serif;">Trang <span class="pageNumber"></span></div>',
  });

  await browser.close();
  console.log('Partner PDF exported!');
})();
