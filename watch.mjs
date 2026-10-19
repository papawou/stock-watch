#!/usr/bin/env node
// Stock alert: checks each product page in watch.json once, pushes to ntfy when it becomes orderable
// (or when its status changes), remembers the last status in state.json. Never logs in, never buys.
//
//   NTFY_TOPIC=... node watch.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0 Safari/537.36';
const STATE_FILE = 'state.json';
const topic = process.env.NTFY_TOPIC;
// Manual run ("Run workflow" button): always push the current status, so a test visibly works.
const manual = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
const { items } = JSON.parse(readFileSync('watch.json', 'utf8'));
const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {};
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function push(title, message, url) {
  log(`🔔 ${title} — ${message}`);
  if (!topic) return log('⚠ NTFY_TOPIC not set — no push');
  const res = await fetch('https://ntfy.sh/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, title, message, priority: 5, click: url, tags: ['rotating_light'] }),
  }).catch((e) => ({ ok: false, status: e.message }));
  if (!res.ok) log(`⚠ ntfy push failed: ${res.status}`);
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const text = (html) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// CS-Cart product page (400coups.ch), read from the page's own markup:
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
  return {
    orderable: !noPrice && hasCartButton,
    label: [price && `${price} CHF`, status].filter(Boolean).join(' — '),
  };
}

async function check(item) {
  const res = await fetch(item.url, {
    headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'fr-CH,fr;q=0.9' },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 429) return { skip: 'HTTP 429 (trop de requêtes) — on réessaie au prochain passage' };
  if (res.status === 404 || res.status === 410) return { orderable: false, label: `page introuvable (HTTP ${res.status})` };
  if (!res.ok) return { skip: `HTTP ${res.status}` };
  const html = await res.text();
  return readCsCart(html) ?? { skip: 'format de page inconnu — le site a peut-être changé' };
}

let failures = 0;
for (const item of items) {
  let r;
  try {
    r = await check(item);
  } catch (e) {
    r = { skip: e.message };
  }
  const prev = state[item.url];
  if (r.skip) {
    failures++;
    log(`⏭ ${item.name}: ${r.skip}`);
    if (manual) await push(`Test — ${item.name}`, `Page non lue : ${r.skip}`, item.url);
    continue;
  }
  log(`${r.orderable ? '✅' : '⏳'} ${item.name}: ${r.label}`);
  if (!prev) {
    await push(`Surveillance démarrée`, `${item.name} — ${r.orderable ? 'COMMANDABLE !' : r.label}`, item.url);
  } else if (r.orderable && !prev.orderable) {
    await push(`🚨 COMMANDABLE — ${item.name}`, `${r.label} — fonce !`, item.url);
  } else if (r.label !== prev.label) {
    await push(`Changement — ${item.name}`, `${prev.label} → ${r.label}`, item.url);
  } else if (manual) {
    await push(`Test OK — ${item.name}`, `${r.orderable ? 'COMMANDABLE !' : r.label} (rien n'a changé)`, item.url);
  }
  state[item.url] = { orderable: r.orderable, label: r.label, at: new Date().toISOString() };
}
writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
if (failures === items.length) process.exitCode = 0; // a blocked run is not an error: just wait for the next one
