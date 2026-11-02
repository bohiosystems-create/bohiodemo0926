// Minimal vCard (.vcf) reader for contacts exported from iPhone / iCloud / Google / Outlook.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VCard = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const unescape = (v) => String(v || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

  // Returns [{ name, email, emails[], phone, company, title, notes }]
  function parse(text) {
    // Unfold continuation lines (a line starting with a space or tab continues the previous one)
    const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
    const out = [];
    let cur = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (/^BEGIN:VCARD$/i.test(line)) { cur = { emails: [], phones: [] }; continue; }
      if (/^END:VCARD$/i.test(line)) { if (cur) out.push(finish(cur)); cur = null; continue; }
      if (!cur || !line.includes(':')) continue;
      const i = line.indexOf(':');
      const head = line.slice(0, i), value = line.slice(i + 1);
      const key = head.split(';')[0].replace(/^item\d+\./i, '').toUpperCase();
      const params = head.toUpperCase();
      if (key === 'FN') cur.fn = unescape(value);
      else if (key === 'N') { const [last, first] = value.split(';'); cur.n = [unescape(first), unescape(last)].filter(Boolean).join(' '); }
      else if (key === 'EMAIL') cur.emails.push({ v: unescape(value).toLowerCase(), pref: /PREF/.test(params), work: /WORK/.test(params) });
      else if (key === 'TEL') cur.phones.push({ v: unescape(value), pref: /PREF/.test(params), cell: /CELL|IPHONE|MOBILE/.test(params) });
      else if (key === 'ORG') cur.org = unescape(value.split(';')[0]);
      else if (key === 'TITLE') cur.title = unescape(value);
      else if (key === 'NOTE') cur.note = unescape(value);
    }
    return out;
  }

  function finish(c) {
    const email = (c.emails.find((e) => e.pref) || c.emails.find((e) => e.work) || c.emails[0] || {}).v || '';
    const phone = (c.phones.find((p) => p.cell) || c.phones.find((p) => p.pref) || c.phones[0] || {}).v || '';
    return { name: c.fn || c.n || c.org || email, email, emails: c.emails.map((e) => e.v), phone, company: c.org || '', title: c.title || '', notes: c.note || '' };
  }

  // Same shape from the browser Contact Picker API: [{ name: [], email: [], tel: [] }]
  function fromPicker(list) {
    return (list || []).map((c) => ({
      name: (c.name || [])[0] || (c.email || [])[0] || '', email: String((c.email || [])[0] || '').toLowerCase(), emails: (c.email || []).map((e) => String(e).toLowerCase()),
      phone: (c.tel || [])[0] || '', company: '', title: '', notes: '',
    }));
  }

  return { parse, fromPicker };
});
