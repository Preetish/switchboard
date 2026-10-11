/**
 * Switchboard embed loader — the script customers paste on their site.
 *
 * Finds `<div data-switchboard-form="<slug>">` placeholders and injects an
 * iframe of the hosted form page in embed mode (`?embed=1`). The hosted page
 * owns the whole submit → route → book flow and reports its height via
 * postMessage so the iframe resizes with no scrollbars.
 *
 * Placeholders added later (single-page apps, modals) are mounted
 * automatically; `window.Switchboard.mount()` mounts on demand.
 *
 * Source of truth: packages/embed/embed.js. `npm run build -w @switchboard/embed`
 * minifies this file into apps/web/public/embed.js; a guard test keeps the
 * committed artifact under 10 KB and in sync with this source.
 */
(function () {
  "use strict";

  if (window.Switchboard && window.Switchboard.mount) return; // loaded twice

  // The origin of this script file is the Switchboard deployment. When the
  // tag is injected by a tag manager (no currentScript), mark it with
  // `data-switchboard-embed` so it can be found unambiguously.
  var script =
    document.currentScript ||
    document.querySelector("script[data-switchboard-embed]") ||
    document.querySelector('script[src$="/embed.js"]');
  var base = script ? new URL(script.src, location.href).origin : "";
  var frames = [];

  // One listener for every widget: only trust a resize message from one of
  // our iframes, sent from the Switchboard origin.
  window.addEventListener("message", function (event) {
    if (event.origin !== base) return;
    var data = event.data;
    if (!data || data.type !== "switchboard:resize") return;
    for (var i = 0; i < frames.length; i++) {
      var iframe = frames[i];
      if (event.source !== iframe.contentWindow) continue;
      var height = Number(data.height);
      if (Number.isFinite(height) && height >= 200 && height <= 4000) {
        iframe.style.height = Math.round(height) + "px";
      }
      return;
    }
  });

  function mount() {
    if (!base) {
      // Without the script URL we cannot know the deployment origin; an
      // empty base would silently point the iframe at the host's origin.
      console.warn("[switchboard] embed.js must be loaded via <script src=...>");
      return;
    }
    var nodes = document.querySelectorAll("[data-switchboard-form]");
    Array.prototype.forEach.call(nodes, function (node) {
      var slug = node.getAttribute("data-switchboard-form");
      if (!slug || node.__sbEmbed) return;
      node.__sbEmbed = true;
      var iframe = document.createElement("iframe");
      iframe.src = base + "/f/" + encodeURIComponent(slug) + "?embed=1";
      iframe.title = node.getAttribute("data-switchboard-title") || "Book a meeting";
      iframe.style.cssText =
        "width:100%;border:0;color-scheme:normal;display:block;height:600px;transition:height .2s ease-out";
      frames.push(iframe);
      node.appendChild(iframe);
    });
  }

  window.Switchboard = { mount: mount };

  function start() {
    mount();
    if (window.MutationObserver) {
      var pending = false;
      new window.MutationObserver(function () {
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () {
          pending = false;
          mount();
        });
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
