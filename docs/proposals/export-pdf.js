const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--font-render-hinting=none', '--force-color-profile=srgb', '--disable-dev-shm-usage'],
    protocolTimeout: 120000,
  });
  const page = await browser.newPage();

  const WIDTH = 1100;
  await page.setViewport({ width: WIDTH, height: 900, deviceScaleFactor: 1.5 });
  await page.emulateMediaType('screen');

  await page.goto('http://localhost:8899/levelup-corelev-eu-proposal.html', {
    waitUntil: 'networkidle0',
    timeout: 30000,
  });

  await page.evaluateHandle('document.fonts.ready');
  await new Promise(r => setTimeout(r, 3000));

  // Chụp screenshot chỉ phần hero, rồi thay thế hero bằng ảnh
  const heroBounds = await page.evaluate(() => {
    const hero = document.querySelector('.hero');
    return { top: hero.offsetTop, left: hero.offsetLeft, width: hero.offsetWidth, height: hero.offsetHeight };
  });

  const heroShot = await page.screenshot({
    clip: { x: heroBounds.left, y: heroBounds.top, width: heroBounds.width, height: heroBounds.height },
    type: 'png',
    encoding: 'base64',
  });

  // Thay hero bằng ảnh screenshot (giữ link không bị ảnh hưởng)
  await page.evaluate((imgBase64, h) => {
    const hero = document.querySelector('.hero');
    hero.style.backgroundImage = `url(data:image/png;base64,${imgBase64})`;
    hero.style.backgroundSize = 'cover';
    hero.style.backgroundPosition = 'center';
    // Ẩn ::before pattern overlay
    const style = document.createElement('style');
    style.textContent = '.hero::before { display: none !important; }';
    document.head.appendChild(style);
  }, heroShot, heroBounds.height);

  // Tương tự cho CTA section
  const ctaBounds = await page.evaluate(() => {
    const cta = document.querySelector('.cta');
    return { top: cta.offsetTop, left: cta.offsetLeft, width: cta.offsetWidth, height: cta.offsetHeight };
  });

  const ctaShot = await page.screenshot({
    clip: { x: ctaBounds.left, y: ctaBounds.top, width: ctaBounds.width, height: ctaBounds.height },
    type: 'png',
    encoding: 'base64',
  });

  await page.evaluate((imgBase64) => {
    const cta = document.querySelector('.cta');
    cta.style.backgroundImage = `url(data:image/png;base64,${imgBase64})`;
    cta.style.backgroundSize = 'cover';
    cta.style.backgroundPosition = 'center';
    const style = document.createElement('style');
    style.textContent = `
      .cta::before { display: none !important; }
      .cta, .cta * { color: transparent !important; }
    `;
    document.head.appendChild(style);
  }, ctaShot);

  // Inject page-break CSS để sections không bị cắt
  await page.addStyleTag({
    content: `
      .section, .cta, .toc { page-break-inside: avoid; break-inside: avoid; }
      .hero { page-break-after: always; break-after: page; }
    `
  });

  await new Promise(r => setTimeout(r, 500));

  // Xuất PDF trực tiếp — giữ text selectable + links clickable
  const pxToMm = 0.2646;
  const wMM = Math.ceil(WIDTH * pxToMm);
  const hMM = Math.ceil(WIDTH * 1.414 * pxToMm); // A4 ratio

  await page.pdf({
    path: 'c:/Users/Admin/Desktop/Agentic-AI-Levelup/docs/proposals/levelup-corelev-eu-proposal.pdf',
    width: `${wMM}mm`,
    height: `${hMM}mm`,
    printBackground: true,
    margin: { top: '5mm', bottom: '5mm', left: '5mm', right: '5mm' },
  });

  await browser.close();
  console.log('PDF exported with clickable links!');
})();
