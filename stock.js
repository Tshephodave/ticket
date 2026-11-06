const { Order } = require('./models');

// Tickets held by pending or approved requests (rejected requests release their tickets)
async function soldMap(ticketIds) {
  if (!ticketIds.length) return new Map();
  const rows = await Order.aggregate([
    { $match: { status: { $ne: 'rejected' }, 'items.ticketId': { $in: ticketIds } } },
    { $unwind: '$items' },
    { $match: { 'items.ticketId': { $in: ticketIds } } },
    { $group: { _id: '$items.ticketId', sold: { $sum: '$items.qty' } } }
  ]);
  return new Map(rows.map(r => [String(r._id), r.sold]));
}

async function withStock(events) {
  const sold = await soldMap(events.flatMap(e => e.tickets.map(t => t._id)));
  return events.map(e => {
    const json = e.toJSON();
    json.tickets = json.tickets.map(t => ({ ...t, remaining: Math.max(0, t.quantity - (sold.get(t.id) || 0)) }));
    return json;
  });
}

module.exports = { soldMap, withStock };
