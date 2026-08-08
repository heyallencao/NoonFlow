import { sanitizeForIframe } from './widget-sanitizer';

interface BuildReceiverSrcdocOptions {
  html: string;
  title?: string;
  bridgeToken?: string;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildReceiverSrcdoc(options: BuildReceiverSrcdocOptions): string {
  const sanitizedHtml = sanitizeForIframe(options.html);
  const escapedTitle = escapeHtml(options.title || 'Generated Widget');
  const bridgeToken = options.bridgeToken || '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; script-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
    />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapedTitle}</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      }

      * {
        box-sizing: border-box;
        max-width: 100%;
      }

      html,
      body {
        margin: 0;
        padding: 0;
        background: transparent;
        color: canvastext;
      }

      body {
        min-height: 0;
      }

      svg {
        display: block;
      }

      table {
        border-collapse: collapse;
      }
    </style>
  </head>
  <body>
    ${sanitizedHtml}
    <script>
      (function () {
        var MIN_HEIGHT = 120;
        var MAX_HEIGHT = 1800;
        var BRIDGE_TOKEN = ${JSON.stringify(bridgeToken)};

        function clampHeight(value) {
          var numeric = Number(value) || 0;
          if (numeric < MIN_HEIGHT) return MIN_HEIGHT;
          if (numeric > MAX_HEIGHT) return MAX_HEIGHT;
          return Math.ceil(numeric);
        }

        function postBridgeMessage(payload) {
          // targetOrigin must be '*' here: sandboxed srcdoc iframes have
          // origin 'null', so a specific origin cannot be targeted. Security
          // is enforced on the receive side — WidgetRenderer validates both
          // event.source (iframe contentWindow) and the per-instance bridgeToken.
          window.parent.postMessage(Object.assign({
            source: 'noonflow-widget',
            bridgeToken: BRIDGE_TOKEN
          }, payload), '*');
        }

        function reportSize() {
          var body = document.body;
          var html = document.documentElement;
          if (!body || !html) return;
          var nextHeight = clampHeight(Math.max(body.scrollHeight, html.scrollHeight));
          postBridgeMessage({
            type: 'resize',
            height: nextHeight
          });
        }

        function reportLink(href) {
          postBridgeMessage({
            type: 'link',
            href: href || ''
          });
        }

        function reportAsk(content) {
          postBridgeMessage({
            type: 'ask',
            content: content || ''
          });
        }

        document.addEventListener('click', function (event) {
          var element = event.target;
          if (!(element instanceof Element)) return;

          var actionTrigger = element.closest('[data-widget-send]');
          if (actionTrigger) {
            event.preventDefault();
            reportAsk(actionTrigger.getAttribute('data-widget-send'));
            return;
          }

          var anchor = element.closest('a');
          if (!anchor) return;
          var href = anchor.getAttribute('href') || '';
          if (!href) return;
          event.preventDefault();
          if (href.toLowerCase().startsWith('ask:')) {
            reportAsk(href.slice(4));
            return;
          }
          reportLink(href);
        });

        window.addEventListener('load', reportSize);
        window.addEventListener('resize', reportSize);
        if (window.ResizeObserver) {
          var observer = new ResizeObserver(reportSize);
          observer.observe(document.documentElement);
          observer.observe(document.body);
        }
        setTimeout(reportSize, 0);
        setTimeout(reportSize, 120);
      })();
    </script>
  </body>
</html>`;
}
