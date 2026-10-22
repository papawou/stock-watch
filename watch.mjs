#!/usr/bin/env node
// Stock alert, one pass: reads every watch in watch.json once, pushes to ntfy when something new
// appears, becomes orderable or changes, and remembers what it saw in state.json. Never logs in, never buys.
//
//   NTFY_TOPIC=... node watch.mjs            normal pass: push only on changes
//   NTFY_TOPIC=... REPORT=1 node watch.mjs   test pass: always push the current status
//
// Two kinds of watch in watch.json:
//   "products": one product page each (400coups.ch, CS-Cart) → is THIS product orderable?
//   "searches": product lists of a shop + keyword filter → which matching products exist, are they orderable?
//               "shop": "prestashop" (red-line.shop) or "woocommerce" (mix-image.ch)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0 Safari/537.36';
const STATE_FILE = 'state.json';
const topic = process.env.NTFY_TOPIC;
const report = process.env.REPORT === '1' || process.env.REPORT === 'true';
const config = JSON.parse(readFileSync('watch.json', 'utf8'));
const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {};
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function push(title, message, url) {
  log(`🔔 ${title} — ${message}`);
  if (!topic) return log('⚠ NTFY_TOPIC not set — no push');
  const res = await fetch('https://ntfy.sh/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, title, message, priority: 5, ...(url && { click: url }), tags: ['rotating_light'] }),
  }).catch((e) => ({ ok: false, status: e.message }));
  if (!res.ok) log(`⚠ ntfy push failed: ${res.status}`);
}

class Skip extends Error {} // page not readable this time (429, 5xx, timeout): try again next pass, no alert

async function get(url, accept) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'fr-CH,fr;q=0.9', 'X-Requested-With': 'XMLHttpRequest' },
    signal: AbortSignal.timeout(30_000),
  }).catch((e) => {
    throw new Skip(e.message);
  });
  if (res.status === 429) throw new Skip('HTTP 429 (trop de requêtes)');
  if (!res.ok) throw new Skip(`HTTP ${res.status}`);
  return res;
}

const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const text = (html) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
// "Pokémon 30ème" → "pokemon 30eme"
const norm = (s) => s.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// ---------- products: one CS-Cart product page (400coups.ch) ----------
//  - not orderable yet: the price block shows "ty-no-price" ("[Commande bientôt disponible]")
//  - orderable: a real add-to-cart control with id="button_cart_<ID>" (class "et-in-stock") exists
//  - sold out: no such control, the button reads "Rupture de stock" (class "et-out-of-stock")
function readCsCart(html) {
  const id = html.match(/id="price_update_(\d+)"/)?.[1];
  if (!id) return null;
  const tag = html.indexOf(`id="price_update_${id}"`);
  const start = html.indexOf('>', tag) + 1;
  const priceBlock = html.slice(start, html.indexOf(`<!--price_update_${id}-->`, start));
  const noPrice = priceBlock.match(/class="ty-no-price"[^>]*>([^<]*)</)?.[1].trim();
  const price = noPrice ? null : text(priceBlock).replace(/^(\d+) (\d{2})$/, '$1.$2') || null;
  const hasCartButton = html.includes(`id="button_cart_${id}"`);
  const soldOut = !hasCartButton && /et-out-of-stock|Rupture de stock/.test(html);
  const status = noPrice ?? (hasCartButton ? 'Ajouter au panier dispo' : soldOut ? 'Rupture de stock' : 'pas de bouton panier');
  return { orderable: !noPrice && hasCartButton, label: [price && `${price} CHF`, status].filter(Boolean).join(' — ') };
}

async function watchProduct(item) {
  const html = await (await get(item.url, 'text/html')).text();
  const r = readCsCart(html);
  if (!r) throw new Skip('format de page inconnu — le site a peut-être changé');
  log(`${r.orderable ? '✅' : '⏳'} ${item.name}: ${r.label}`);

  const prev = state[item.url];
  if (!prev) await push('Surveillance démarrée', `${item.name} — ${r.orderable ? 'COMMANDABLE !' : r.label}`, item.url);
  else if (r.orderable && !prev.orderable) await push(`🚨 COMMANDABLE — ${item.name}`, `${r.label} — fonce !`, item.url);
  else if (r.label !== prev.label) await push(`Changement — ${item.name}`, `${prev.label} → ${r.label}`, item.url);
  else if (report) await push(`Test OK — ${item.name}`, `${r.orderable ? 'COMMANDABLE !' : r.label} (rien n'a changé)`, item.url);
  state[item.url] = { orderable: r.orderable, label: r.label, at: new Date().toISOString() };
}

// ---------- searches: PrestaShop product lists (red-line.shop) + keyword filter ----------
// PrestaShop answers listing/search pages with JSON when asked with X-Requested-With: XMLHttpRequest.
// add_to_cart_url is only filled when the product can actually be ordered.
async function listPrestaShop(base, path) {
  const url = new URL(path, base);
  url.searchParams.set('resultsPerPage', '100');
  const j = await (await get(url, 'application/json')).json();
  return (j.products ?? []).map((p) => ({
    id: String(p.id_product),
    name: decode(p.name),
    price: p.price,
    url: p.url,
    orderable: Boolean(p.add_to_cart_url),
    status: p.add_to_cart_url ? 'commandable' : 'pas encore commandable',
    categories: [],
    // Red Line ends titles with "- FR" / "- ENG" / "- JPN"
    language: decode(p.name).trim().match(/[-–]\s*(FR|ENG?|JPN?|DE|IT|ES|KR|CN)\s*$/i)?.[1].toUpperCase().replace(/^EN$/, 'ENG').replace(/^JP$/, 'JPN') ?? null,
  }));
}

// WooCommerce public Store API (no login): /wp-json/wc/store/v1/products?... → JSON product list.
// is_purchasable && is_in_stock = the "Ajouter au panier" button works (in stock, or preorder/backorder).
const LANGUAGE_WORDS = { FR: /fran[cç]ais|french/i, JPN: /japonais|japanese/i, ENG: /anglais|english/i, DE: /allemand|deutsch/i, CN: /chinois|chinese/i, KR: /cor[eé]en|korean/i };
function wooLanguage(p, name) {
  const attr = p.attributes?.find((a) => /^langue|^language/i.test(a.name))?.terms?.map((t) => t.name).join(', ');
  if (attr) return LANGUAGE_WORDS.FR.test(attr) ? 'FR' : (Object.entries(LANGUAGE_WORDS).find(([, re]) => re.test(attr))?.[0] ?? attr);
  // No attribute: the shop usually puts the language in the name, e.g. "(JP)", "- FR"
  const tag = name.match(/[(\[\s-–](FR|JP|JPN|EN|ENG|DE|CN|KR)[)\]\s]*$/i)?.[1].toUpperCase();
  if (tag) return { JP: 'JPN', EN: 'ENG' }[tag] ?? tag;
  return Object.entries(LANGUAGE_WORDS).find(([, re]) => re.test(name))?.[0] ?? null;
}

async function listWooCommerce(base, path) {
  const url = new URL(path, base);
  const j = await (await get(url, 'application/json')).json();
  return j.map((p) => {
    const name = decode(p.name);
    const minor = p.prices?.currency_minor_unit ?? 2;
    const orderable = Boolean(p.is_purchasable && p.is_in_stock);
    return {
      id: String(p.id),
      name,
      price: p.prices?.price ? `${(Number(p.prices.price) / 10 ** minor).toFixed(2)} ${p.prices.currency_code ?? ''}`.trim() : '?',
      url: p.permalink,
      orderable,
      status: decode(p.stock_availability?.text || '') || (orderable ? 'commandable' : 'pas encore commandable'),
      categories: (p.categories ?? []).map((c) => c.slug),
      language: wooLanguage(p, name),
    };
  });
}

const LISTERS = { prestashop: listPrestaShop, woocommerce: listWooCommerce };

// Each group is a list of words; the name must contain at least one word of EVERY group, and none of `exclude`.
const hasWord = (name, w) => new RegExp(`(^|[^a-z0-9])${norm(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(name);
// A product is kept when:
//  - its name contains a word of every `allOf` group, OR it is in one of `categories` (e.g. "30th-celebration"),
//  - and its name has none of `exclude`, and it is in none of `excludeCategories` (prefix match: "accessoires"),
//  - and, if `language` is set, its language is that one (unknown language is kept, flagged "langue ?").
function matches(p, { allOf, exclude = [], categories = [], excludeCategories = [], language }) {
  const n = norm(p.name);
  const byName = allOf.every((group) => group.some((w) => hasWord(n, w)));
  const byCategory = p.categories.some((c) => categories.includes(c));
  if (!byName && !byCategory) return false;
  if (exclude.some((w) => hasWord(n, w))) return false;
  if (p.categories.some((c) => excludeCategories.some((x) => c.startsWith(x)))) return false;
  if (language && p.language && p.language !== language) return false;
  return true;
}
const describe = (p, language) =>
  `${p.name} — ${p.price} — ${p.status}${language && !p.language ? ' (langue ?)' : ''}`;

async function watchSearch(s) {
  const seen = new Map();
  let read = 0;
  for (const path of s.pages) {
    try {
      for (const p of await LISTERS[s.shop ?? 'prestashop'](s.base, path)) seen.set(p.id, p);
      read++;
    } catch (e) {
      if (!(e instanceof Skip)) throw e;
      log(`⏭ ${s.name} ${path}: ${e.message}`);
      if (e.message.includes('429')) break; // the shop asks us to slow down: stop this pass
    }
  }
  if (!read) throw new Skip('aucune page lue');

  const hits = [...seen.values()].filter((p) => matches(p, s.match));
  log(`🔎 ${s.name}: ${seen.size} produits lus, ${hits.length} correspondent`);
  for (const p of hits) log(`   ${p.orderable ? '✅' : '⏳'} #${p.id} [${p.language ?? '??'}] ${describe(p, s.match.language)}`);

  const key = `search:${s.name}`;
  const first = !state[key];
  const known = state[key]?.products ?? {};
  const lines = [];
  for (const p of hits) {
    const before = known[p.id];
    if (!before && !first) await push(`🆕 ${s.name}${p.orderable ? ' — COMMANDABLE' : ''}`, describe(p, s.match.language), p.url);
    else if (before && p.orderable && !before.orderable) await push(`🚨 COMMANDABLE — ${p.name}`, `${p.price} — ${p.status} — fonce !`, p.url);
    lines.push(`${p.orderable ? '✅' : '⏳'} ${describe(p, s.match.language)}`);
  }
  if (first) await push('Surveillance démarrée', `${s.name} — ${hits.length ? lines.join(' / ') : 'aucun article pour l’instant'}`, s.link);
  else if (report) await push(`Test OK — ${s.name}`, hits.length ? lines.join(' / ') : `aucun article pour l’instant (${seen.size} produits lus)`, s.link);

  // Products that disappeared from the lists are kept: a delisting during a drop must not re-trigger "new".
  state[key] = {
    products: { ...known, ...Object.fromEntries(hits.map((p) => [p.id, { name: p.name, orderable: p.orderable }])) },
    at: new Date().toISOString(),
  };
}

// ---------- one pass ----------
const watches = [
  ...(config.products ?? []).map((w) => ({ name: w.name, link: w.url, run: () => watchProduct(w) })),
  ...(config.searches ?? []).map((w) => ({ name: w.name, link: w.link, run: () => watchSearch(w) })),
];
for (const w of watches) {
  try {
    await w.run();
  } catch (e) {
    if (!(e instanceof Skip)) throw e;
    log(`⏭ ${w.name}: ${e.message} — on réessaie au prochain passage`);
    if (report) await push(`Test — ${w.name}`, `Page non lue : ${e.message}`, w.link);
  }
}
writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
