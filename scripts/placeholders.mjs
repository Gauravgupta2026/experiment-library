// Writes neutral placeholder images to public/media. Run: node scripts/placeholders.mjs
// The photos in the source recordings belong to other people, so the app ships these in their place.
import { mkdirSync, writeFileSync } from 'node:fs';

const PAIRS = [['#F3B4C8', '#8E9BFF'], ['#FFD49A', '#F0609A'], ['#B9E6D3', '#3F8CFF'], ['#E7D4FF', '#FF9A6B'], ['#FCE38A', '#6BCB9A'], ['#C9D6FF', '#B06AB3']];
const W = 900, H = 1200;

mkdirSync('public/media', { recursive: true });
PAIRS.forEach(([a, b], i) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
<radialGradient id="r" cx=".3" cy=".25" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="url(#g)"/><rect width="${W}" height="${H}" fill="url(#r)"/>
<text x="50%" y="54%" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-weight="600" font-size="420" fill="#fff" fill-opacity=".85">${i + 1}</text></svg>`;
  writeFileSync(`public/media/placeholder-${i + 1}.svg`, svg);
});
console.log(`Wrote ${PAIRS.length} placeholders`);
