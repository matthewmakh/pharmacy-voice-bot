// Opens a generated HTML document in a new browser tab with CPLR print styles.
// Uses a blob URL — no server roundtrip, no Puppeteer required.
export function openHtmlInTab(html: string, title: string) {
  const isFullDoc = /<html/i.test(html);
  const wrapped = isFullDoc
    ? html.replace(/<\/head>/i, `<style>body{margin:1in;max-width:8.5in;font-family:'Times New Roman',Times,serif;}</style></head>`)
    : `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>
        body{font-family:'Times New Roman',Times,serif;font-size:12pt;line-height:2;margin:1in;color:#000;max-width:8.5in;}
        h1,h2,h3,h4{font-family:'Times New Roman',Times,serif;}
        p{margin:0 0 0.5em;}a{color:#000;text-decoration:none;}
        table{border-collapse:collapse;width:100%;}td,th{border:1px solid #000;padding:4px 8px;vertical-align:top;}
        strong,b{font-weight:bold;}
      </style></head><body>${html}</body></html>`;
  const blob = new Blob([wrapped], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
