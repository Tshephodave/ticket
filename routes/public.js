const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const QRCode = require('qrcode');
const { Event, Order, Gallery, Image, getSettings } = require('../models');
const { soldMap, withStock } = require('../stock');
const { wrap } = require('../middleware');
const { sendPdf } = require('../pdf');

const router = express.Router();
const DEFAULT_PAYMENT = process.env.PAYMENT_INSTRUCTIONS ||
  'Ola will contact you on WhatsApp with payment details. Use your reference when you pay. Your tickets are released once payment is confirmed.';

router.get('/images/:id', wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.sendStatus(404);
  const img = await Image.findById(req.params.id);
  if (!img) return res.sendStatus(404);
  res.set({ 'Content-Type': img.contentType, 'Cache-Control': 'public, max-age=31536000, immutable', 'Cross-Origin-Resource-Policy': 'cross-origin' });
  res.send(img.data);
}));

router.get('/settings', wrap(async (req, res) => {
  const s = await getSettings();
  res.json({ heroImage: s.heroImage, whatsapp: s.whatsapp, email: s.email });
}));

router.get('/events', wrap(async (req, res) => {
  const events = await Event.find({ date: { $gte: new Date(Date.now() - 6 * 3600 * 1000) } }).sort({ date: 1 });
  res.json(await withStock(events));
}));

router.get('/gallery', wrap(async (req, res) => res.json(await Gallery.find().sort({ createdAt: -1 }))));

router.post('/orders', wrap(async (req, res) => {
  const { eventId, name, email, phone, items } = req.body || {};
  if (!name || !email || !Array.isArray(items)) return res.status(400).json({ error: 'Please fill in your name and email.' });
  const event = mongoose.isValidObjectId(eventId) ? await Event.findById(eventId) : null;
  if (!event) return res.status(404).json({ error: 'That event no longer exists.' });

  const typeIds = event.tickets.map(t => t._id);
  const sold = await soldMap(typeIds);
  const lines = [];
  let total = 0;
  for (const item of items) {
    const qty = parseInt(item.qty, 10);
    if (!qty || qty < 1) continue;
    const type = mongoose.isValidObjectId(item.ticketId) ? event.tickets.id(item.ticketId) : null;
    if (!type) return res.status(400).json({ error: 'Unknown ticket type.' });
    if (qty > 10) return res.status(400).json({ error: 'You can request up to 10 tickets of one type.' });
    if (qty > type.quantity - (sold.get(String(type._id)) || 0)) {
      return res.status(409).json({ error: `Only a few ${type.name} tickets are left. Please reduce the quantity.` });
    }
    total += qty * type.price;
    lines.push({ ticketId: type._id, name: type.name, price: type.price, qty });
  }
  if (!lines.length) return res.status(400).json({ error: 'Choose at least one ticket.' });

  let order;
  for (let i = 0; i < 3 && !order; i++) {
    try {
      order = await Order.create({
        reference: 'REF-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
        eventId: event._id, eventTitle: event.title, eventDate: event.date, venue: event.venue, includes: event.includes,
        name: String(name).trim(), email, phone: phone || '', items: lines, total
      });
    } catch (e) { if (e.code !== 11000) throw e; }
  }
  if (!order) return res.status(500).json({ error: 'Could not create your request. Please try again.' });

  // Two people may request the last tickets at the same moment: check again and undo if oversold
  const after = await soldMap(typeIds);
  if (event.tickets.some(t => (after.get(String(t._id)) || 0) > t.quantity)) {
    await Order.deleteOne({ _id: order._id });
    return res.status(409).json({ error: 'Those tickets were just taken. Please try again with fewer tickets.' });
  }
  const settings = await getSettings();
  res.json({ reference: order.reference, total, status: order.status, instructions: settings.paymentInstructions || DEFAULT_PAYMENT });
}));

const findOrder = (ref, email) => Order.findOne({
  reference: String(ref || '').trim().toUpperCase(),
  email: String(email || '').trim().toLowerCase()
});

router.get('/orders/lookup', wrap(async (req, res) => {
  const o = await findOrder(req.query.ref, req.query.email);
  if (!o) return res.status(404).json({ error: 'We could not find a request with that reference and email.' });
  res.json({
    reference: o.reference, status: o.status, eventTitle: o.eventTitle, total: o.total, name: o.name,
    items: o.items, tickets: o.status === 'approved' ? o.tickets.map(t => ({ code: t.code, ticketName: t.ticketName })) : []
  });
}));

router.get('/orders/pdf', wrap(async (req, res) => {
  const o = await findOrder(req.query.ref, req.query.email);
  if (!o) return res.status(404).json({ error: 'Request not found.' });
  if (o.status !== 'approved') return res.status(403).json({ error: 'Your tickets are not released yet.' });
  await sendPdf(o.toJSON(), res);
}));

router.get('/tickets/:code/qr', wrap(async (req, res) => {
  res.type('png').send(await QRCode.toBuffer(req.params.code, { margin: 1, width: 240 }));
}));

module.exports = router;
