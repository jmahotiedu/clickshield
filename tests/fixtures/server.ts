import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const port = Number.parseInt(process.env.PORT ?? '4173', 10);
const host = '127.0.0.1';

function send(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  body: string,
): void {
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-type': contentType,
  });
  response.end(body);
}

function html(title: string, body: string, script = ''): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; }
      #fixture-ad { width: 20rem; padding: 1rem; border: 1px solid; }
      #transparent-overlay {
        position: fixed;
        inset: 0;
        z-index: 99999;
        opacity: 0.01;
        background: rgba(0, 0, 0, 0);
        pointer-events: auto;
      }
    </style>
  </head>
  <body>
    ${body}
    <script>${script}</script>
  </body>
</html>`;
}

function route(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (url.pathname === '/health') {
    send(response, 200, 'text/plain; charset=utf-8', 'ok');
    return;
  }

  if (url.pathname === '/ad.js') {
    send(
      response,
      200,
      'text/javascript; charset=utf-8',
      "window.adLoaded = true; document.querySelector('#network-status').textContent = 'loaded';",
    );
    return;
  }

  if (url.pathname === '/site-toggle') {
    send(
      response,
      200,
      'text/html; charset=utf-8',
      html(
        'Site toggle fixture',
        '<h1>Site toggle</h1><div id="fixture-ad" data-ad-slot>Advertisement fixture</div>',
      ),
    );
    return;
  }

  if (url.pathname === '/network') {
    send(
      response,
      200,
      'text/html; charset=utf-8',
      html(
        'Network fixture',
        '<h1>Network blocking</h1><p id="network-status">pending</p>',
        `window.adLoaded = false;
const script = document.createElement('script');
script.src = 'http://ads.clickshield.test:${port}/ad.js';
script.addEventListener('error', () => {
  document.querySelector('#network-status').textContent = 'blocked';
});
document.head.append(script);`,
      ),
    );
    return;
  }

  if (url.pathname === '/popup-protection') {
    send(
      response,
      200,
      'text/html; charset=utf-8',
      html(
        'Popup fixture',
        `<h1>Popup protection</h1>
<a id="legitimate-link" href="http://player.clickshield.test:${port}/destination" target="_blank" rel="opener">Legitimate article</a>
<a id="auth-link" href="http://auth.clickshield.test:${port}/oauth/authorize" target="_blank" rel="opener">Sign in</a>
<a id="known-ad-link" href="http://ads.clickshield.test:${port}/ad-popup" target="_blank" rel="opener">Known ad destination</a>
<a id="popunder-link" href="http://ads.clickshield.test:${port}/ad-popup" target="_blank" rel="opener" hidden>Hidden ad destination</a>
<button id="trigger-popunder" type="button">Trigger pop-under</button>
<button id="trigger-ordinary-popup" type="button">Trigger ordinary popup</button>`,
        `document.querySelector('#trigger-popunder').addEventListener('click', () => {
  document.querySelector('#popunder-link').click();
});
document.querySelector('#trigger-ordinary-popup').addEventListener('click', () => {
  setTimeout(() => {
    window.open('http://ordinary.clickshield.test:${port}/ordinary-popup', '_blank');
  }, 900);
});`,
      ),
    );
    return;
  }

  if (url.pathname === '/iframe-popup-host') {
    send(
      response,
      200,
      'text/html; charset=utf-8',
      html(
        'Iframe popup host',
        `<h1>Iframe popup host</h1>
<iframe id="popup-frame" src="http://frame.clickshield.test:${port}/iframe-popup-frame"></iframe>`,
      ),
    );
    return;
  }

  if (url.pathname === '/iframe-popup-frame') {
    send(
      response,
      200,
      'text/html; charset=utf-8',
      html(
        'Iframe popup frame',
        '<button id="trigger-frame-popup" type="button">Trigger frame popup</button>',
        `document.querySelector('#trigger-frame-popup').addEventListener('click', () => {
  setTimeout(() => {
    window.open('http://ordinary.clickshield.test:${port}/ordinary-popup', '_blank');
  }, 900);
});`,
      ),
    );
    return;
  }

  if (url.pathname === '/overlay-protection') {
    send(
      response,
      200,
      'text/html; charset=utf-8',
      html(
        'Overlay fixture',
        '<h1>Overlay protection</h1><button id="real-control" type="button">Play</button>',
        `setTimeout(() => {
  const overlay = document.createElement('div');
  overlay.id = 'transparent-overlay';
  document.body.append(overlay);
}, 100);`,
      ),
    );
    return;
  }

  if (
    url.pathname === '/destination' ||
    url.pathname === '/oauth/authorize' ||
    url.pathname === '/ad-popup' ||
    url.pathname === '/ordinary-popup'
  ) {
    send(
      response,
      200,
      'text/html; charset=utf-8',
      html('Destination fixture', `<h1>${url.pathname}</h1>`),
    );
    return;
  }

  send(response, 404, 'text/plain; charset=utf-8', 'not found');
}

const server = createServer(route);
server.listen(port, host, () => {
  process.stdout.write(`ClickShield fixture server listening on http://${host}:${port}\n`);
});

function shutdown(): void {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
