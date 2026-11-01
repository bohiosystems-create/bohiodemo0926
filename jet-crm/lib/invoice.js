// Client invoices: built from the selected operator quote + brokerage fee, issued under the business profile.
const PDFDocument = require('pdfkit');
const store = require('./store');
const Pricing = require('../public/shared/pricing');

const routeText = (r) => r.legs.map((l) => `${l.from} - ${l.to}${l.date ? ` (${l.date})` : ''}`).join(', ') || 'Route TBC';

function lineText(kind, r, q, inv) {
  if (kind === 'fee') {
    const rule = inv.feeRule;
    const pct = rule.type === 'percent' && !inv.minApplied ? ` (${rule.value}%)` : '';
    return { description: `Brokerage & arrangement fee${pct}`, detail: `Ref ${r.ref}` };
  }
  return {
    description: `Private jet charter: ${routeText(r)}`,
    detail: [q.aircraft, q.year && `YOM ${q.year}`, q.tail, r.pax && `${r.pax} passengers`].filter(Boolean).join(' · '),
  };
}

function create(request, quoteId) {
  const db = store.load();
  const existing = request.invoiceId && db.invoices.find((x) => x.id === request.invoiceId && x.status !== 'void');
  if (existing) throw Object.assign(new Error(`Invoice ${existing.number} already exists for this trip. Void it first to invoice a different quote.`), { status: 409 });
  const q = request.quotes.find((x) => x.id === quoteId);
  if (!q) throw new Error('Quote not found');
  if (q.price == null) throw new Error('This quote has no price. Edit the quote price first.');
  const biz = db.business;
  const feeRule = Pricing.effectiveFee(request, biz);
  const totals = Pricing.invoiceTotals(q, feeRule, biz);
  const issue = new Date();
  const due = new Date(issue.getTime() + (Number(biz.paymentTermsDays) || 0) * 86400000);
  const number = `${biz.invoicePrefix || 'INV'}-${issue.getFullYear()}-${String(biz.nextInvoiceNo || 1).padStart(4, '0')}`;
  const inv = {
    id: store.id('inv'), number, status: 'issued', requestId: request.id, requestRef: request.ref, quoteId: q.id,
    issueDate: issue.toISOString().slice(0, 10), dueDate: due.toISOString().slice(0, 10), createdAt: issue.toISOString(),
    seller: { ...biz }, // snapshot so later profile edits don't change an issued invoice
    billTo: { name: request.client?.name, company: request.client?.company, email: request.client?.email, phone: request.client?.phone },
    supplier: { company: q.company, aircraft: q.aircraft, tail: q.tail },
    feeRule, ...totals,
  };
  inv.lines = totals.lines.map((l) => ({ ...l, ...lineText(l.kind, request, q, inv) }));
  delete inv.seller.nextInvoiceNo;
  biz.nextInvoiceNo = (Number(biz.nextInvoiceNo) || 1) + 1;
  db.invoices.unshift(inv);
  q.status = 'selected';
  request.quotes.forEach((x) => { if (x !== q && x.status === 'selected') x.status = 'received'; });
  request.invoiceId = inv.id;
  request.status = 'proposal';
  store.log('invoice', `Invoice ${number} issued to ${inv.billTo.name || inv.billTo.email}: ${inv.currency} ${inv.total.toLocaleString('en-US')}`, { requestId: request.id });
  store.save();
  return inv;
}

const fmt = (n, c) => `${c} ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function pdf(inv) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Invoice ${inv.number}`, Author: inv.seller.name } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    const s = inv.seller, gold = '#9a7b3a', ink = '#111827', mute = '#6b7280';
    const W = doc.page.width - 100;

    doc.fillColor(ink).font('Helvetica-Bold').fontSize(20).text(s.name || 'Your Brokerage', 50, 50, { width: W * 0.6 });
    doc.font('Helvetica').fontSize(9).fillColor(mute)
      .text([s.address, [s.email, s.phone].filter(Boolean).join('  ·  '), s.website, s.taxId && `VAT / Tax no. ${s.taxId}`, s.regNo && `Company reg. ${s.regNo}`].filter(Boolean).join('\n'), { width: W * 0.6 });
    doc.font('Helvetica-Bold').fontSize(22).fillColor(gold).text('INVOICE', 50, 50, { width: W, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor(ink)
      .text(`No. ${inv.number}\nIssued ${inv.issueDate}\nDue ${inv.dueDate}\nTrip ref ${inv.requestRef}`, 50, 80, { width: W, align: 'right' });

    let y = Math.max(doc.y, 140) + 16;
    doc.moveTo(50, y).lineTo(50 + W, y).strokeColor('#e5e7eb').stroke();
    y += 14;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(mute).text('BILL TO', 50, y);
    doc.font('Helvetica').fontSize(11).fillColor(ink)
      .text([inv.billTo.company, inv.billTo.name, inv.billTo.email, inv.billTo.phone].filter(Boolean).join('\n'), 50, y + 14);
    y = doc.y + 24;

    doc.rect(50, y, W, 22).fill('#f3f4f6');
    doc.fillColor(mute).font('Helvetica-Bold').fontSize(9).text('DESCRIPTION', 58, y + 7).text(`AMOUNT (${inv.currency})`, 50, y + 7, { width: W - 8, align: 'right' });
    y += 30;
    for (const l of inv.lines) {
      doc.fillColor(ink).font('Helvetica').fontSize(10.5).text(fmt(l.amount, ''), 50, y, { width: W - 8, align: 'right' });
      doc.fillColor(ink).font('Helvetica-Bold').fontSize(10.5).text(l.description, 58, y, { width: W - 150 });
      if (l.detail) doc.font('Helvetica').fontSize(9).fillColor(mute).text(l.detail, 58, doc.y + 2, { width: W - 150 });
      y = doc.y + 10;
      doc.moveTo(50, y).lineTo(50 + W, y).strokeColor('#e5e7eb').stroke();
      y += 10;
    }

    const row = (label, val, bold) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10).fillColor(ink)
        .text(label, 50 + W - 260, y, { width: 140 }).text(val, 50, y, { width: W - 8, align: 'right' });
      y += bold ? 22 : 16;
    };
    y += 4;
    row('Subtotal', fmt(inv.subtotal, inv.currency));
    if (inv.vatRate) row(`VAT ${inv.vatRate}%${inv.seller.vatOn === 'fee' ? ' (on fee)' : ''}`, fmt(inv.vat, inv.currency));
    doc.moveTo(50 + W - 260, y).lineTo(50 + W, y).strokeColor(gold).stroke(); y += 8;
    row('Total due', fmt(inv.total, inv.currency), true);

    y += 20;
    if (s.iban || s.bankName) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(mute).text('PAYMENT DETAILS', 50, y);
      doc.font('Helvetica').fontSize(10).fillColor(ink).text([
        s.accountName && `Account name: ${s.accountName}`, s.bankName && `Bank: ${s.bankName}`, s.iban && `IBAN: ${s.iban}`, s.swift && `SWIFT/BIC: ${s.swift}`,
        `Reference: ${inv.number}`,
      ].filter(Boolean).join('\n'), 50, y + 14);
      y = doc.y + 18;
    }
    if (s.invoiceNotes) doc.font('Helvetica').fontSize(8.5).fillColor(mute).text(s.invoiceNotes, 50, y, { width: W });
    doc.end();
  });
}

module.exports = { create, pdf };
