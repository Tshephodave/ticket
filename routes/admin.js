const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { Event, Order, Gallery, getSettings } = require('../models');
const { withStock, soldMap } = require('../stock');
const { upload, saveImage, deleteImage, signToken, auth, wrap } = require('../middleware');
const { sendPdf } = require('../pdf');

const router = express.Router();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
if (!process.env.ADMIN_PASSWORD) console.warn('ADMIN_PASSWORD is not set: using the default "changeme". Set it in .env before going live.');
const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
const ticketCode = () => 'OLA-' + crypto.randomBytes(4).toString('hex').toUpperCase();

/* ----- login (slows down password guessing) ----- */
const attempts = new Map();
router.post('/login', (req, res) => {
  const now = Date.now();
  const recent = (attempts.get(req.ip) || []).filter(t => now - t < 15 * 60 * 1000);
  if (recent.length >= 10) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  if (!crypto.timingSafeEqual(digest((req.body || {}).password || ''), digest(ADMIN_PASSWORD))) {
    recent.push(now); attempts.set(req.ip, recent);
    return res.status(401).json({ error: 'Wrong password.' });
  }
  attempts.delete(req.ip);
  res.json({ token: signToken() });
});

router.use(auth);

/* ----- events ----- */
router.get('/events', wrap(async (req, res) => res.json(await withStock(await Event.find().sort({ date: -1 })))));

router.post('/events', wrap(async (req, res) => {
  const { title, date, venue, description, image, includes, tickets } = req.body || {};
  const when = new Date(date);
  if (!title || isNaN(when) || !Array.isArray(tickets) || !tickets.length) return res.status(400).json({ error: 'Add a title, a date and at least one ticket type.' });
  const types = tickets.map(t => ({ name: t.name, price: Number(t.price), quantity: parseInt(t.quantity, 10) }));
  if (types.some(t => !t.name || !(t.price >= 0) || !(t.quantity >= 1))) return res.status(400).json({ error: 'Check the ticket names, prices and quantities.' });
  const event = await Event.create({ title, date: when, venue, description, image, includes: includes || undefined, tickets: types });
  res.json(event);
}));

router.put('/events/:id', wrap(async (req, res) => {
  const ev = await Event.findById(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Event not found.' });
  const { title, date, venue, description, image, includes, tickets } = req.body || {};
  const when = new Date(date);
  if (!title || isNaN(when) || !Array.isArray(tickets) || !tickets.length) return res.status(400).json({ error: 'Add a title, a date and at least one ticket type.' });
  const types = tickets.map(t => ({ id: t.id ? String(t.id) : '', name: String(t.name || '').trim(), price: Number(t.price), quantity: parseInt(t.quantity, 10) }));
  if (types.some(t => !t.name || !(t.price >= 0) || !(t.quantity >= 1))) return res.status(400).json({ error: 'Check the ticket names, prices and quantities.' });

  // Protect tickets that are already requested or sold
  const sold = await soldMap(ev.tickets.map(t => t._id));
  const kept = new Set(types.filter(t => t.id).map(t => t.id));
  for (const t of ev.tickets) {
    const n = sold.get(String(t._id)) || 0;
    if (!kept.has(String(t._id)) && n > 0) return res.status(400).json({ error: `"${t.name}" already has ${n} ticket(s) requested, so it cannot be removed.` });
  }
  for (const t of types.filter(x => x.id)) {
    const existing = ev.tickets.id(t.id);
    if (!existing) return res.status(400).json({ error: 'One of the ticket types no longer exists. Reload and try again.' });
    const n = sold.get(String(existing._id)) || 0;
    if (t.quantity < n) return res.status(400).json({ error: `"${t.name}" already has ${n} ticket(s) requested, so the quantity cannot go below ${n}.` });
  }

  const oldImage = ev.image;
  ev.title = title.trim();
  ev.date = when;
  ev.venue = venue || '';
  ev.description = description || '';
  ev.includes = includes || 'Buffet and drinks of your choice';
  if (typeof image === 'string') ev.image = image;
  ev.tickets = types.map(t => (t.id ? { _id: t.id, name: t.name, price: t.price, quantity: t.quantity } : { name: t.name, price: t.price, quantity: t.quantity }));
  await ev.save();
  if (oldImage && oldImage !== ev.image) await deleteImage(oldImage);
  res.json((await withStock([ev]))[0]);
}));

router.delete('/events/:id', wrap(async (req, res) => {
  const ev = await Event.findByIdAndDelete(req.params.id);
  if (ev) await deleteImage(ev.image);
  res.json({ ok: true });
}));

router.post('/upload', upload.single('photo'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose an image file.' });
  res.json({ url: await saveImage(req.file) });
}));

/* ----- ticket requests ----- */
router.get('/orders', wrap(async (req, res) => res.json(await Order.find().sort({ createdAt: -1 }))));

router.post('/orders/:id/approve', wrap(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.status !== 'pending') return res.status(400).json({ error: 'Only pending requests can be approved.' });
  const tickets = order.items.flatMap(it => Array.from({ length: it.qty }, () => ({ code: ticketCode(), ticketId: it.ticketId, ticketName: it.name, used: false })));
  const done = await Order.findOneAndUpdate({ _id: order._id, status: 'pending' }, { $set: { status: 'approved', approvedAt: new Date(), tickets } }, { new: true });
  if (!done) return res.status(400).json({ error: 'This request was already handled.' });
  res.json(done);
}));

router.post('/orders/:id/reject', wrap(async (req, res) => {
  const done = await Order.findOneAndUpdate({ _id: req.params.id, status: 'pending' }, { $set: { status: 'rejected' } }, { new: true });
  if (!done) return res.status(400).json({ error: 'Only pending requests can be rejected.' });
  res.json(done);
}));

router.get('/orders/:id/pdf', wrap(async (req, res) => {
  const o = await Order.findById(req.params.id);
  if (!o || o.status !== 'approved') return res.status(404).json({ error: 'No approved tickets for this order.' });
  await sendPdf(o.toJSON(), res);
}));

/* ----- gallery ----- */
router.post('/gallery', upload.single('photo'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose an image file.' });
  res.json(await Gallery.create({ url: await saveImage(req.file), caption: (req.body.caption || '').trim() }));
}));
router.delete('/gallery/:id', wrap(async (req, res) => {
  const g = await Gallery.findByIdAndDelete(req.params.id);
  if (g) await deleteImage(g.url);
  res.json({ ok: true });
}));

/* ----- check-in at the door (atomic, so a ticket cannot be used twice) ----- */
router.post('/checkin', wrap(async (req, res) => {
  const code = String((req.body || {}).code || '').trim().toUpperCase();
  const order = await Order.findOneAndUpdate(
    { status: 'approved', tickets: { $elemMatch: { code, used: false } } },
    { $set: { 'tickets.$.used': true } }, { new: true });
  if (order) {
    const t = order.tickets.find(x => x.code === code);
    return res.json({ ok: true, name: order.name, event: order.eventTitle, ticket: t.ticketName });
  }
  const existing = code ? await Order.findOne({ 'tickets.code': code }) : null;
  if (!existing) return res.status(404).json({ error: 'Ticket not found.' });
  if (existing.status !== 'approved') return res.status(400).json({ error: 'This ticket request has not been approved.' });
  res.status(409).json({ error: 'This ticket was already used.' });
}));

/* ----- website settings ----- */
router.get('/settings', wrap(async (req, res) => res.json(await getSettings())));

router.post('/settings', upload.single('hero'), wrap(async (req, res) => {
  const s = await getSettings();
  const b = req.body || {};
  if (typeof b.whatsapp === 'string') {
    let digits = b.whatsapp.replace(/\D/g, '');
    if (digits.startsWith('0')) digits = '27' + digits.slice(1); // South African numbers
    s.whatsapp = digits;
  }
  if (typeof b.email === 'string') s.email = b.email.trim();
  if (typeof b.paymentInstructions === 'string') s.paymentInstructions = b.paymentInstructions.trim();
  if (req.file) { await deleteImage(s.heroImage); s.heroImage = await saveImage(req.file); }
  else if (b.removeHero === '1') { await deleteImage(s.heroImage); s.heroImage = ''; }
  await s.save();
  res.json(s);
}));

module.exports = router;
