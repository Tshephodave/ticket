const mongoose = require('mongoose');
const { Schema } = mongoose;

// Send "id" instead of "_id" so the front-end gets simple ids
mongoose.set('toJSON', {
  versionKey: false,
  transform: (doc, ret) => {
    if (ret._id !== undefined) { ret.id = String(ret._id); delete ret._id; }
    return ret;
  }
});

const Event = mongoose.model('Event', new Schema({
  title: { type: String, required: true, trim: true },
  date: { type: Date, required: true },
  venue: { type: String, default: '' },
  description: { type: String, default: '' },
  image: { type: String, default: '' },
  includes: { type: String, default: 'Buffet and drinks of your choice' },
  tickets: [{
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 }
  }]
}, { timestamps: true }));

const Order = mongoose.model('Order', new Schema({
  reference: { type: String, required: true, unique: true },
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', index: true },
  eventTitle: String,
  eventDate: Date,
  venue: String,
  includes: String,
  name: { type: String, required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  phone: { type: String, default: '' },
  items: [new Schema({ ticketId: Schema.Types.ObjectId, name: String, price: Number, qty: Number }, { _id: false })],
  total: Number,
  tickets: [new Schema({ code: { type: String, index: true }, ticketId: Schema.Types.ObjectId, ticketName: String, used: { type: Boolean, default: false } }, { _id: false })],
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  approvedAt: Date
}, { timestamps: true }));

// Uploaded images live in MongoDB. Event.image, Gallery.url and Setting.heroImage
// store the string "/api/images/<id>", which the API serves from this collection.
const Image = mongoose.model('Image', new Schema({
  data: { type: Buffer, required: true },
  contentType: { type: String, required: true },
  size: Number
}, { timestamps: true }));

const Gallery = mongoose.model('Gallery', new Schema({
  url: { type: String, required: true },
  caption: { type: String, default: '' }
}, { timestamps: true }));

// One settings document for the whole site
const Setting = mongoose.model('Setting', new Schema({
  key: { type: String, default: 'main', unique: true },
  heroImage: { type: String, default: '' },
  whatsapp: { type: String, default: '' },
  email: { type: String, default: '' },
  paymentInstructions: { type: String, default: '' }
}));
const getSettings = () => Setting.findOneAndUpdate({ key: 'main' }, { $setOnInsert: { key: 'main' } }, { upsert: true, new: true });

module.exports = { Event, Order, Gallery, Image, Setting, getSettings };
