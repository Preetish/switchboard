/**
 * Switchboard embed loader — the script customers paste on their site.
 *
 * Finds `<div data-switchboard-form="<slug>">` placeholders and injects an
 * iframe of the hosted form page in embed mode (`?embed=1`). The hosted page
 * owns the whole submit → route → book flow and reports its height via
 * postMessage so the iframe resizes with no scrollbars.
 *
 * Source of truth: packages/embed/embed.js. `npm run build -w @switchboard/embed`
 * minifies this file into apps/web/public/embed.js; a guard test keeps the
 * committed artifact under 10 KB and in sync with this source.
 */
(function () {
  "use strict";

  // The origin of this script file is the Switchboard deployment.
  var script = document.currentScript || document.querySelector('script[src*="embed.js"]');
  var base = script ? new URL(script.src).origin : "";

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
      iframe.title = "Booking form";
      iframe.loading = "lazy";
      iframe.style.cssText =
        "width:100%;border:0;color-scheme:normal;display:block;height:600px;transition:height .2s ease-out";
      node.appendChild(iframe);
      window.addEventListener("message", function (event) {
        // Only trust resize messages for this exact iframe, from its origin.
        if (event.origin !== base || event.source !== iframe.contentWindow) return;
        var data = event.data;
        if (!data || data.type !== "switchboard:resize") return;
        var height = Number(data.height);
        if (Number.isFinite(height) && height >= 200 && height <= 4000) {
          iframe.style.height = Math.round(height) + "px";
        }
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
