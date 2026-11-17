"""Quoting map as a one-page landscape A3 PDF, prices in USD from the wizard's pricing model (/tmp/usd.json)."""
import json
from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

pdfmetrics.registerFont(TTFont("DV", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("DVB", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))
from reportlab.lib.fonts import addMapping
addMapping("DV", 0, 0, "DV"); addMapping("DV", 1, 0, "DVB")

import os, sys
R = json.load(open(os.path.join(os.path.dirname(__file__), "routes_usd.json")))
W, H = landscape(A3)
NAVY, BLUE, GREY, LINE = colors.HexColor("#1F3A5F"), colors.HexColor("#0a5cff"), colors.HexColor("#5b6470"), colors.HexColor("#d5dbe3")
FILL = {"green": colors.HexColor("#d9f2e4"), "yellow": colors.HexColor("#fff1c7"), "peach": colors.HexColor("#ffdccc")}
EDGE = {"green": colors.HexColor("#00a05a"), "yellow": colors.HexColor("#d99a00"), "peach": colors.HexColor("#e6261f")}
usd = lambda v: f"${v:,.0f}"
mo = lambda v: f"${v:,.2f}" if v % 1 else f"${v:,.0f}"

c = canvas.Canvas(os.path.join(os.path.dirname(__file__), "Bohio_HVAC_Quoting_Map_USD.pdf"), pagesize=(W, H))
c.setTitle("Bohio Systems - HVAC AI retrofit quoting map (USD)"); c.setAuthor("Bohio Systems")

def para(txt, x, y_top, w, size=9, lead=None, color=colors.black, bold=False):
    st = ParagraphStyle("p", fontName="DVB" if bold else "DV", fontSize=size, leading=lead or size * 1.3, textColor=color)
    p = Paragraph(txt, st); _, h = p.wrap(w, 1000); p.drawOn(c, x, y_top - h); return h

# header band
c.setFillColor(NAVY); c.rect(0, H - 34, W, 34, stroke=0, fill=1)
c.setFillColor(colors.white); c.setFont("DVB", 13); c.drawString(36, H - 22, "BOHIO SYSTEMS")
c.setFont("DV", 9); c.drawRightString(W - 36, H - 22, "Quoting map  |  prices in US dollars, excl. VAT  |  17 Nov 2026")
c.setFillColor(NAVY); c.setFont("DVB", 26); c.drawString(36, H - 72, "Quoting map: AI HVAC retrofit")
c.setFillColor(colors.black); c.setFont("DV", 13); c.drawString(36, H - 92, "Launch phase: offer only the low-cost, low-risk routes.")
para("Reference building: G+4, 20 flats, about 1,700-2,600 sqm, 67 indoor units (25 if ducted). One-time = hardware + installation, USD excl. VAT. "
     "Monthly = platform fee per controlled unit + 4G connectivity.", 36, H - 102, 560, 8.5, color=GREY)
# key
kx = 640
OFF_FILL, OFF_EDGE = colors.HexColor("#eceff3"), colors.HexColor("#9aa4b2")
for i, (k, lbl) in enumerate([("green", "Offer now: low risk"), ("yellow", "Conditional"), ("off", "Not offered yet")]):
    x = kx + i * 150
    c.setFillColor(FILL.get(k, OFF_FILL)); c.setStrokeColor(EDGE.get(k, OFF_EDGE)); c.roundRect(x, H - 118, 18, 12, 3, stroke=1, fill=1)
    c.setFillColor(colors.black); c.setFont("DV", 9); c.drawString(x + 24, H - 115, lbl)

# root diamond
cx, cy, dw, dh = W / 2, H - 165, 230, 70
p = c.beginPath(); p.moveTo(cx, cy + dh / 2); p.lineTo(cx + dw / 2, cy); p.lineTo(cx, cy - dh / 2); p.lineTo(cx - dw / 2, cy); p.close()
c.setFillColor(colors.white); c.setStrokeColor(NAVY); c.setLineWidth(1.5); c.drawPath(p, stroke=1, fill=1)
c.setFillColor(NAVY); c.setFont("DVB", 11); c.drawCentredString(cx, cy - 4, "Does the building have a BMS?")

# sections
top, sec_h = H - 240, 408
A = (36, top, 250)               # x, top, width
B = (306, top, W - 306 - 36)
for (x, t, w), title in ((A, "Has a BMS: is it open and writable?"), (B, "No BMS: what cooling equipment is installed?")):
    c.setStrokeColor(LINE); c.setLineWidth(1); c.setFillColor(colors.HexColor("#f6f8fb"))
    c.roundRect(x, t - sec_h, w, sec_h, 8, stroke=1, fill=1)
    c.setFillColor(NAVY); c.setFont("DVB", 11.5); c.drawString(x + 2, t + 8, title)

# arrows root -> sections
def arrow(x1, y1, x2, y2, label):
    c.setStrokeColor(NAVY); c.setLineWidth(1.4); my = (y1 + y2) / 2 + 6
    c.line(x1, y1, x1, my); c.line(x1, my, x2, my); c.line(x2, my, x2, y2 + 6)
    p = c.beginPath(); p.moveTo(x2, y2); p.lineTo(x2 - 4, y2 + 8); p.lineTo(x2 + 4, y2 + 8); p.close()
    c.setFillColor(NAVY); c.drawPath(p, stroke=0, fill=1)
    c.setFont("DVB", 10); c.drawString(x2 + 6, my + 4, label)
arrow(cx, cy - dh / 2, A[0] + A[2] / 2, top + 24, "Yes")
arrow(cx, cy - dh / 2, B[0] + B[2] / 2, top + 24, "No")

STATUS = {"A1": "cond", "A2": "no", "A3": "yes", "B1": "yes", "B2": "yes", "B3": "no", "C1": "no", "C2": "no", "D1": "yes", "E1": "yes"}
OFF_FILL, OFF_EDGE = colors.HexColor("#eceff3"), colors.HexColor("#9aa4b2")
def leaf(code, col, x, y_top, w, h, title, line):
    r = R[code]; stt = STATUS[code]
    tag = {"yes": "<font color='#00804a'><b>Offer now.</b></font> ", "cond": "<font color='#a36f00'><b>Only with fixed contractor price.</b></font> ",
           "no": "<font color='#c0201a'><b>Not offered yet.</b></font> "}[stt]
    line = tag + line
    if stt == "no": col = None
    c.setFillColor(FILL[col] if col else OFF_FILL); c.setStrokeColor(EDGE[col] if col else OFF_EDGE); c.setLineWidth(1.2); c.roundRect(x, y_top - h, w, h, 6, stroke=1, fill=1)
    c.setFillColor(BLUE if stt != "no" else OFF_EDGE); c.roundRect(x + 8, y_top - 22, 26, 15, 7, stroke=0, fill=1)
    c.setFillColor(colors.white); c.setFont("DVB", 8.5); c.drawCentredString(x + 21, y_top - 18, code)
    para(f"<b>{title}</b>", x + 40, y_top - 6, w - 48, 9)
    para(line, x + 8, y_top - 34, w - 16, 8.2, color=GREY)
    c.setFillColor(colors.black if stt != "no" else GREY); c.setFont("DVB", 15); c.drawString(x + 8, y_top - h + 30, usd(r["one"]))
    c.setFont("DV", 7.4); c.setFillColor(GREY)
    c.drawString(x + 8, y_top - h + 14, f"HW {usd(r['H'])} · services {usd(r['S'])} · {mo(r['monthly'])}/mo")
    c.drawRightString(x + w - 8, y_top - h + 31, f"{usd(r['perFlat'])}/flat")

lh, gap = 106, 10
ax, aw = A[0] + 12, A[2] - 24
leaf("A1", "yellow", ax, top - 14, aw, lh, "Open BMS (BACnet/IP, Niagara)", "Contractor allowance $5,500.")
leaf("A2", "peach", ax, top - 14 - (lh + gap), aw, lh, "Legacy BMS (N2, LON, old panels)", "Needs a $7,000 upgrade allowance. Offer advisory (A3) instead.")
leaf("A3", "green", ax, top - 14 - 2 * (lh + gap), aw, lh, "BMS, read-only access", "Advisory: AI recommends, FM applies (Office-in-the-Loop route). Best first step.")

cols = [("Chilled-water fan coils", [("B1", "green", "Thermostats already Modbus", "Keep them; wire RS485 to a gateway."),
                                    ("B2", "green", "Basic 230 V: wireless", "67 LoRaWAN FCU thermostats, no new cables. = current quote."),
                                    ("B3", "yellow", "Basic 230 V: wired Modbus", "Cabling in occupied flats. Use B2 instead.")]),
        ("Wall-mounted split ACs", [("C1", "yellow", "IR controllers (Sensibo)", "One-way control, high hardware cost. Offer monitoring + advice."),
                                   ("C2", "peach", "Wired Intesis gateways", "Highest cost per unit. Offer monitoring + advice.")]),
        ("Ducted DX / packaged (24 V)", [("D1", "green", "24 V LoRaWAN thermostats", "25 units: 1 per flat + 5 common.")]),
        ("VRF system", [("E1", "green", "Gateway on the VRF controller", "Reads and writes all indoor units at once.")])]
bx0, bw = B[0] + 12, B[2] - 24
cw = (bw - 3 * 12) / 4
for i, (head, leaves) in enumerate(cols):
    x = bx0 + i * (cw + 12)
    c.setFillColor(colors.white); c.setStrokeColor(NAVY); c.setLineWidth(1); c.roundRect(x, top - 40, cw, 26, 13, stroke=1, fill=1)
    c.setFillColor(NAVY); c.setFont("DVB", 9.5); c.drawCentredString(x + cw / 2, top - 31, head)
    for j, (code, col, t, l) in enumerate(leaves):
        leaf(code, col, x, top - 52 - j * (lh + gap) + 0, cw, lh, t, l)


px = bx0 + 2 * (cw + 12); pw = 2 * cw + 12; ptop = top - 52 - lh - 16; pbot = top - sec_h + 12
c.setFillColor(colors.white); c.setStrokeColor(NAVY); c.setLineWidth(1.2); c.roundRect(px, pbot, pw, ptop - pbot, 6, stroke=1, fill=1)
b2 = R["B2"]; hwcost = b2["H"] / 1.25
para("<b>Launch policy: low cost, low risk</b>", px + 12, ptop - 10, pw - 24, 11, color=NAVY)
para(f"""&#8226; <b>Offer now:</b> A3, B1, B2, D1, E1. <b>A1</b> only with a fixed BMS-contractor price.<br/>
&#8226; <b>Not yet:</b> A2, B3, C1, C2. Offer metering + advisory reports instead.<br/>
&#8226; <b>One standard kit:</b> UG65 gateway, RUT956 router, RevPi edge, Milesight devices.<br/>
&#8226; <b>No stock:</b> order per project; 60% deposit covers hardware cost
(B2: ${b2["H"]:,.0f} ÷ 1.25 = ${hwcost:,.0f} cost vs 60% × ${b2["one"]:,.0f} = ${0.6*b2["one"]:,.0f} deposit).<br/>
&#8226; <b>Install via MEP partner</b> at a fixed price per unit; no installers on payroll.<br/>
&#8226; <b>Advisory or shadow mode first</b>, then live control.<br/>
&#8226; <b>Paid site survey</b>, credited against the order.<br/>
&#8226; <b>Decline</b> sites with no way to meter savings, or where the owner doesn't benefit.""",
     px + 12, ptop - 32, pw - 24, 9.6, lead=15)

# rules row
ry = top - sec_h - 30
c.setFillColor(NAVY); c.setFont("DVB", 13); c.drawString(36, ry, "Rules for every route (from the papers)")
rules = [("Supervisory only", "AI changes setpoints and schedules; local controls keep safety loops and fallback (LBNL, BrainBox)."),
         ("Advisory, shadow, live", "No LLM runs a live building alone yet (2026 review); Office-in-the-Loop kept people applying changes."),
         ("Numbers decide, LLM explains", "Rules, MPC or RL set setpoints; the LLM handles context and tenant requests (LLM + RL papers, Gen-HVAC)."),
         ("District cooling limit", "Hard floor on chilled-water return temperature (Delta T), or savings trigger penalties."),
         ("Meter first", "4-week baseline plus BTU or CT metering, or savings can't be proven.")]
rw = (W - 72 - 4 * 12) / 5
for i, (t, d) in enumerate(rules):
    x = 36 + i * (rw + 12)
    c.setFillColor(colors.HexColor("#f6f8fb")); c.setStrokeColor(LINE); c.roundRect(x, ry - 80, rw, 66, 6, stroke=1, fill=1)
    para(f"<b>{t}</b><br/>{d}", x + 8, ry - 18, rw - 16, 8.4)

para("How prices are built: hardware = online price in USD (converted at £1 = $1.30, €1 = $1.15) × 1.12 shipping and customs × 1.25 margin. "
     "Labour at assumed UAE rates: thermostat swap $40, RS485 cabling $70 per unit, fixed services about $5,250. Allow. = estimate to confirm on site. "
     "Monthly = $5.50 per controlled unit + $40 connectivity (advisory $2.75). Split, ducted and VRF routes assume electricity-bill metering with sample current clamps; "
     "fan-coil routes assume a district-cooling BTU meter. Retail list prices: UAE distributor quotes will differ.", 36, ry - 96, W - 72, 8, color=GREY)
c.showPage(); c.save()
