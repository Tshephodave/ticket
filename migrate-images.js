// One-off: moves images from backend/uploads/ into MongoDB and rewrites the stored URLs.
// Run once from the backend folder:  node migrate-images.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { Event, Gallery, Setting, Image } = require('./models');

const UPLOADS = path.join(__dirname, 'uploads');
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

async function move(url) {
  const m = /\/uploads\/([^/?#]+)$/.exec(url || '');
  if (!m) return null;
  const file = path.join(UPLOADS, path.basename(m[1]));
  if (!fs.existsSync(file)) { console.warn('  missing file, skipped:', file); return null; }
  const data = fs.readFileSync(file);
  const img = await Image.create({ data, contentType: TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', size: data.length });
  return `/api/images/${img.id}`;
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  let n = 0;
  for (const e of await Event.find({ image: /\/uploads\// })) { const u = await move(e.image); if (u) { e.image = u; await e.save(); n++; } }
  for (const g of await Gallery.find({ url: /\/uploads\// })) { const u = await move(g.url); if (u) { g.url = u; await g.save(); n++; } }
  for (const s of await Setting.find({ heroImage: /\/uploads\// })) { const u = await move(s.heroImage); if (u) { s.heroImage = u; await s.save(); n++; } }
  console.log(`Done. Moved ${n} image(s) into MongoDB. You can now delete backend/uploads/.`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
