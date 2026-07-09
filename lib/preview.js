const dns = require('dns/promises');
const net = require('net');

// Convert an IPv4-mapped IPv6 address to its dotted IPv4 form. The WHATWG URL
// parser serializes these to compressed hex (e.g. ::ffff:7f00:1), which the
// naive '::ffff:' + dotted-decimal check never catches — so decode both forms.
function mappedToIpv4(ipv6) {
  const rest = ipv6.toLowerCase().replace(/^::ffff:/, '');
  if (rest === ipv6.toLowerCase()) return null;
  if (net.isIPv4(rest)) return rest;
  const groups = rest.split(':');
  if (groups.length !== 2) return null;
  const hi = parseInt(groups[0], 16);
  const lo = parseInt(groups[1], 16);
  if (Number.isNaN(hi) || Number.isNaN(lo)) return null;
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

function isPrivateIp(ip) {
  const lower = ip.toLowerCase();
  if (net.isIPv6(lower)) {
    const mapped = mappedToIpv4(lower);
    if (mapped) return isPrivateIp(mapped);
    return lower === '::1' || lower === '::' || lower.startsWith('fe80:') ||
      lower.startsWith('fc') || lower.startsWith('fd');
  }
  if (!net.isIPv4(lower)) return true; // unknown format — fail closed
  const [a, b] = lower.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254);
}

async function assertPublicHost(hostname) {
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(bare)) {
    if (isPrivateIp(bare)) throw new Error('Refusing to fetch private address');
    return;
  }
  if (bare === 'localhost' || bare.endsWith('.local') || bare.endsWith('.internal')) {
    throw new Error('Refusing to fetch private address');
  }
  const records = await dns.lookup(bare, { all: true });
  if (records.some((r) => isPrivateIp(r.address))) {
    throw new Error('Refusing to fetch private address');
  }
}

function attrValue(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return m ? (m[1] ?? m[2]) : undefined;
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
// Out-of-range or surrogate code points would make String.fromCodePoint throw;
// the HTML spec maps them to U+FFFD, so clamp instead of crashing the parse.
function codePoint(value) {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) {
    return '�';
  }
  return String.fromCodePoint(value);
}
function decodeEntities(str) {
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => codePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function cleanText(str, max = 500) {
  if (!str) return '';
  return decodeEntities(str).replace(/\s+/g, ' ').trim().slice(0, max);
}

function extractMetadata(html, finalUrl) {
  const metas = {};
  for (const tag of html.match(/<meta\s[^>]*>/gi) || []) {
    const key = (attrValue(tag, 'property') || attrValue(tag, 'name') || '').toLowerCase();
    const content = attrValue(tag, 'content');
    if (key && content !== undefined && !(key in metas)) metas[key] = content;
  }

  let iconHref;
  for (const tag of html.match(/<link\s[^>]*>/gi) || []) {
    const rel = (attrValue(tag, 'rel') || '').toLowerCase();
    if (/(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/.test(rel)) {
      iconHref = attrValue(tag, 'href');
      if (rel.includes('apple-touch-icon')) break;
    }
  }

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const base = new URL(finalUrl);

  const resolve = (maybeRelative) => {
    if (!maybeRelative) return null;
    try {
      return new URL(decodeEntities(maybeRelative), base).href;
    } catch {
      return null;
    }
  };

  return {
    title: cleanText(metas['og:title'] || metas['twitter:title'] || (titleMatch && titleMatch[1]) || base.hostname, 300),
    description: cleanText(metas['og:description'] || metas['twitter:description'] || metas['description']),
    image: resolve(metas['og:image'] || metas['og:image:url'] || metas['twitter:image'] || metas['twitter:image:src']),
    siteName: cleanText(metas['og:site_name'] || base.hostname, 100),
    favicon: resolve(iconHref) || `https://www.google.com/s2/favicons?domain=${base.hostname}&sz=64`,
  };
}

// Can this page be embedded in a cross-origin <iframe>? False when the site
// sends X-Frame-Options (deny/sameorigin/allow-from) or a CSP frame-ancestors
// that isn't the wildcard '*'. Conservative: unknown patterns => not frameable,
// so we never show a guaranteed-blank frame.
function isFrameable(response) {
  const xfo = (response.headers.get('x-frame-options') || '').toLowerCase();
  if (xfo.includes('deny') || xfo.includes('sameorigin') || xfo.includes('allow-from')) return false;
  const csp = (response.headers.get('content-security-policy') || '').toLowerCase();
  const m = csp.match(/frame-ancestors([^;]*)/);
  if (m && m[1].trim() !== '*') return false;
  return true;
}

async function readBodyLimited(response, limit = 1024 * 1024) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchPreview(rawUrl) {
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    throw Object.assign(new Error('Invalid URL'), { status: 400 });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw Object.assign(new Error('Only http(s) URLs are supported'), { status: 400 });
  }
  await assertPublicHost(url.hostname);

  const fallback = {
    url: url.href,
    title: url.hostname,
    description: '',
    image: null,
    siteName: url.hostname,
    favicon: `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=64`,
    fetched: false,
    frameable: false,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Web4webs-LinkPreview',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-US,en;q=0.9',
  };
  try {
    // Follow redirects manually so every hop's host is re-validated BEFORE the
    // request fires — redirect: 'follow' would issue the request to a private
    // redirect target before any guard runs.
    let current = url;
    let response;
    for (let hop = 0; hop <= 5; hop++) {
      await assertPublicHost(current.hostname);
      response = await fetch(current.href, { signal: controller.signal, redirect: 'manual', headers });
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        let next;
        try {
          next = new URL(location, current);
        } catch {
          return fallback;
        }
        if (next.protocol !== 'http:' && next.protocol !== 'https:') return fallback;
        if (response.body) response.body.cancel().catch(() => {});
        current = next;
        continue;
      }
      break;
    }
    if (!response) return fallback;
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('html')) return fallback;
    const frameable = isFrameable(response);
    const html = await readBodyLimited(response);
    return { url: url.href, ...extractMetadata(html, current.href), fetched: true, frameable };
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchPreview };
