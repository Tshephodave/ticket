const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

async function sendPdf(order, res) {
  const SIZE = [595, 300];
  const doc = new PDFDocument({ size: SIZE, margin: 0, info: { Title: `Ola tickets ${order.reference}` } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Ola-tickets-${order.reference}.pdf"`);
  doc.pipe(res);
  const when = new Date(order.eventDate).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  for (let i = 0; i < order.tickets.length; i++) {
    const t = order.tickets[i];
    if (i > 0) doc.addPage({ size: SIZE, margin: 0 });
    doc.rect(0, 0, 595, 64).fill('#24112c');
    doc.fillColor('#ffffff').font('Times-Bold').fontSize(28).text('Ola', 30, 16, { continued: true }).fillColor('#e3c27a').text('.');
    doc.fillColor('#e3c27a').font('Helvetica-Bold').fontSize(12).text('ADMIT ONE', 430, 26, { width: 135, align: 'right' });
    doc.fillColor('#1b1220').font('Helvetica-Bold').fontSize(22).text(order.eventTitle, 30, 86, { width: 380 });
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(12).fillColor('#6f5a76').text(when, 30, doc.y, { width: 380 });
    if (order.venue) doc.text(order.venue, 30, doc.y + 2, { width: 380 });
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#8b2f57').text(t.ticketName, 30, doc.y, { width: 380 });
    doc.font('Helvetica').fontSize(12).fillColor('#1b1220').text(`Guest: ${order.name}`, 30, doc.y + 2, { width: 380 });
    doc.fontSize(10).fillColor('#6f5a76').text(`Includes: ${order.includes}`, 30, doc.y + 6, { width: 380 });
    const qr = await QRCode.toBuffer(t.code, { margin: 1, width: 240 });
    doc.image(qr, 440, 88, { width: 120 });
    doc.font('Courier-Bold').fontSize(14).fillColor('#1b1220').text(t.code, 420, 216, { width: 160, align: 'center' });
    doc.rect(0, 274, 595, 26).fill('#c9a24b');
    doc.fillColor('#24112c').font('Helvetica').fontSize(9)
      .text(`Ref ${order.reference}   |   Ticket ${i + 1} of ${order.tickets.length}   |   Valid for one entry. Show this ticket at the door.`, 30, 283, { width: 535 });
  }
  doc.end();
}

module.exports = { sendPdf };
