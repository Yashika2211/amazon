/** Server-rendered household login and consent page for the OAuth authorization endpoint. */

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const STYLE = `
:root{--bg:#fbf8f1;--card:#fff;--fg:#1d1b16;--muted:#5d5848;--accent:#0b5d4b;--accent-fg:#fff;--line:#d9d2c0;--bad:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#14120e;--card:#1e1b16;--fg:#f5f1e6;--muted:#c9c2ae;--accent:#5fd0b2;--accent-fg:#0b1f1a;--line:#3a352b;--bad:#ff8a80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:18px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}
main{background:var(--card);border:1px solid var(--line);border-radius:16px;max-width:440px;width:100%;padding:28px}
h1{font-size:26px;margin:0 0 4px}p{margin:8px 0;color:var(--muted)}label{display:block;font-weight:600;margin:16px 0 6px}
input{width:100%;font:inherit;font-size:20px;padding:12px 14px;border-radius:10px;border:2px solid var(--line);background:var(--bg);color:var(--fg)}
input:focus{outline:3px solid var(--accent);outline-offset:1px}
button{margin-top:22px;width:100%;font:inherit;font-weight:700;font-size:20px;padding:14px;border-radius:12px;border:0;background:var(--accent);color:var(--accent-fg);cursor:pointer;min-height:52px}
ul{padding-left:20px;color:var(--muted)}.err{color:var(--bad);font-weight:600}.fine{font-size:14px}.brand{font-weight:800;color:var(--accent);letter-spacing:.02em}
`;

export function loginPage(opts: { clientName: string; params: Record<string, string>; error?: string; demoHint?: boolean }): string {
  const hidden = Object.entries(opts.params)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in to KinLoop</title><style>${STYLE}</style></head>
<body><main>
<div class="brand">KinLoop</div>
<h1>Link ${esc(opts.clientName)} to KinLoop</h1>
<p>Sign in with your household name and PIN. ${esc(opts.clientName)} will be able to:</p>
<ul><li>read today's plan, medicines and messages</li><li>log medicines, check-ins and symptoms</li><li>send alerts and messages to your family</li></ul>
${opts.error ? `<p class="err" role="alert">${esc(opts.error)}</p>` : ""}
<form method="post" action="/oauth/authorize" autocomplete="off">
${hidden}
<label for="username">Your KinLoop name</label>
<input id="username" name="username" required autocapitalize="none" spellcheck="false">
<label for="pin">PIN</label>
<input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" required>
<button type="submit">Allow and link</button>
</form>
${opts.demoHint ? `<p class="fine">Demo household: <b>kamala</b> / 1111 (parent) or <b>arjun</b> / 2222 (son). All demo data is fictional.</p>` : ""}
<p class="fine">KinLoop is not a medical device and does not replace emergency services. <a href="/privacy/">Privacy</a> · <a href="/terms/">Terms</a></p>
</main></body></html>`;
}

export function errorPage(message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KinLoop sign-in error</title><style>${STYLE}</style></head>
<body><main><div class="brand">KinLoop</div><h1>Can't continue</h1><p class="err" role="alert">${esc(message)}</p><p>Please go back to the Alexa app and try linking again.</p></main></body></html>`;
}
