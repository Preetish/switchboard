/**
 * Switchboard embed loader — the script customers paste on their site.
 *
 * Finds `<div data-switchboard-form="<slug>">` placeholders and injects an
 * iframe of the hosted form page in embed mode (`?embed=1`). The hosted page
 * owns the whole submit → route → book flow and reports its height via
 * postMessage so the iframe resizes with no scrollbars.
 *
 * Attribution: this script runs on the host page, so it is the part that can
 * see the visitor's landing URL, referrer, and first-party cookies. It hands
 * campaign parameters and click IDs to the form when the form asks
 * (`switchboard:ready` → `switchboard:attribution`).
 * - Without consent it reads only the current URL and referrer and stores
 *   nothing.
 * - With consent (`data-switchboard-consent="granted"` on the script tag, or
 *   `Switchboard.setConsent(true)` from a cookie banner) it also keeps first
 *   and last touch in localStorage for 90 days and reads the analytics and ad
 *   cookie IDs (_ga, _fbp, _fbc, _gcl_aw, hubspotutk).
 *
 * Conversions: when a lead submits or books, the form tells this script,
 * which pushes `switchboard_submitted` / `switchboard_booked` to
 * `window.dataLayer` (GTM, GA4) and dispatches `switchboard:submitted` /
 * `switchboard:booked` DOM events, so your own tags fire on your page.
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

  // Keep in sync with URL_PARAMS in packages/core/src/attribution.ts (a test
  // checks this).
  var PARAMS = [
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
    "gclid", "gbraid", "wbraid", "fbclid", "msclkid", "li_fat_id", "ttclid", "twclid",
  ];
  var COOKIES = { ga: "_ga", fbp: "_fbp", fbc: "_fbc", gcl_aw: "_gcl_aw", hubspotutk: "hubspotutk" };
  var STORE_KEY = "switchboard_attribution";
  var STORE_DAYS = 90;
  var consent = Boolean(script && script.getAttribute("data-switchboard-consent") === "granted");

  function stripUrl(value) {
    try {
      var url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:"
        ? url.origin + url.pathname
        : undefined;
    } catch {
      return undefined;
    }
  }

  /** This visit's touch: campaign params and click IDs, or an external referrer. */
  function currentTouch() {
    var touch = {};
    var found = false;
    var params = new URL(location.href).searchParams;
    PARAMS.forEach(function (name) {
      var value = params.get(name);
      if (value) {
        touch[name] = value.slice(0, 500);
        found = true;
      }
    });
    var external = false;
    try {
      external = Boolean(document.referrer) && new URL(document.referrer).hostname !== location.hostname;
    } catch {
      external = false;
    }
    if (!found && !external) return null;
    if (external) touch.referrer = stripUrl(document.referrer);
    touch.landing_page = stripUrl(location.href);
    touch.captured_at = new Date().toISOString();
    return touch;
  }

  function readStore() {
    try {
      var stored = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      return stored && stored.expires > Date.now() ? stored : null;
    } catch {
      return null;
    }
  }

  function writeStore(value) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(value));
    } catch {
      // Storage blocked: attribution still uses this page's URL.
    }
  }

  var touch = currentTouch();
  var touches = { first: touch, last: touch };

  /** Persist first/last touch across pages; only with consent. */
  function remember() {
    if (!consent) return;
    var stored = readStore() || {};
    if (touch) {
      stored.first = stored.first || touch;
      stored.last = touch;
      stored.expires = Date.now() + STORE_DAYS * 86400000;
      writeStore(stored);
    }
    touches = { first: stored.first || touch, last: stored.last || touch };
  }

  function readCookies() {
    var jar = {};
    document.cookie.split(";").forEach(function (part) {
      var at = part.indexOf("=");
      if (at > 0) jar[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
    });
    var found = {};
    var any = false;
    Object.keys(COOKIES).forEach(function (key) {
      var value = jar[COOKIES[key]];
      if (value) {
        found[key] = value.slice(0, 500);
        any = true;
      }
    });
    return any ? found : null;
  }

  function attribution() {
    var result = {};
    var last = touches.last || {};
    Object.keys(last).forEach(function (key) {
      result[key] = last[key];
    });
    if (touches.first) result.first = touches.first;
    result.page_url = stripUrl(location.href);
    if (consent) {
      var cookies = readCookies();
      if (cookies) result.cookies = cookies;
    }
    return result;
  }

  function sendAttribution(frame) {
    if (frame.iframe.contentWindow) {
      frame.iframe.contentWindow.postMessage(
        { type: "switchboard:attribution", attribution: attribution() },
        base,
      );
    }
  }

  var OUTCOMES = ["route_user", "route_team", "self_serve_link", "fallback_queue"];

  /** Tell the host page about a conversion: GTM/GA4 dataLayer and a DOM event. */
  function emit(frame, name, data) {
    var outcome = data && OUTCOMES.indexOf(data.outcome) !== -1 ? data.outcome : undefined;
    var detail = { form: frame.slug, outcome: outcome };
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: "switchboard_" + name,
      switchboard_form: frame.slug,
      switchboard_outcome: outcome,
    });
    if (typeof CustomEvent === "function") {
      frame.node.dispatchEvent(
        new CustomEvent("switchboard:" + name, { detail: detail, bubbles: true }),
      );
    }
  }

  // One listener for every widget: only trust a message from one of our
  // iframes, sent from the Switchboard origin.
  window.addEventListener("message", function (event) {
    if (event.origin !== base) return;
    var data = event.data;
    if (!data || typeof data.type !== "string") return;
    for (var i = 0; i < frames.length; i++) {
      var frame = frames[i];
      if (event.source !== frame.iframe.contentWindow) continue;
      if (data.type === "switchboard:resize") {
        var height = Number(data.height);
        if (Number.isFinite(height) && height >= 200 && height <= 4000) {
          frame.iframe.style.height = Math.round(height) + "px";
        }
      } else if (data.type === "switchboard:ready") {
        sendAttribution(frame);
      } else if (data.type === "switchboard:event") {
        if (data.name === "submitted" || data.name === "booked") emit(frame, data.name, data);
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
      frames.push({ iframe: iframe, node: node, slug: slug });
      node.appendChild(iframe);
    });
  }

  /** For consent banners: call with true once the visitor accepts. */
  function setConsent(granted) {
    consent = Boolean(granted);
    remember();
    frames.forEach(sendAttribution);
  }

  remember();
  window.Switchboard = { mount: mount, setConsent: setConsent };

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
