"""Build the Bohio Systems HVAC optimisation quotation PDF (5-storey, 20-flat building)."""
import math, os
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_RIGHT, TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                                KeepTogether, PageBreak)

pdfmetrics.registerFont(TTFont("DV", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("DVB", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))

# ---------------- pricing model ----------------
AED_PER_USD = 3.6725          # fixed peg
LANDED = 1.12                 # shipping + 5% customs + handling (assumption)
MARGIN = 1.25                 # hardware margin (assumption)

def client_price(usd):        # unit sell price in USD, rounded up to the dollar
    return math.ceil(usd * LANDED * MARGIN)

FLATS, FCU_PER_FLAT, COMMON_FCU = 20, 3, 7
N_TSTAT = FLATS * FCU_PER_FLAT + COMMON_FCU   # 67

hardware = [  # (item, description, qty, unit AED)
    ("Wireless fan coil thermostat", "Milesight WT301 LoRaWAN, replaces existing wall thermostat; fan speed, valve, setpoint, schedules", N_TSTAT, client_price(114.94)),
    ("Occupancy sensor - common areas", "Milesight WS202 PIR + light, lobby and corridors", COMMON_FCU, client_price(58.50)),
    ("LoRaWAN gateway", "Milesight UG65 (Wi-Fi/PoE), 2 units for full 5-floor coverage and redundancy", 2, client_price(383.99)),
    ("Industrial 4G router", "Teltonika RUT956, dual SIM, VPN, independent of building IT", 1, client_price(275.00)),
    ("Edge controller", "Revolution Pi Connect 4; local control logic, guardrails and fallback", 1, client_price(479.28)),
    ("BTU meter data interface", "M-Bus/Modbus interface to existing district-cooling BTU meter (allowance)", 1, 500),
    ("Panel, UPS & accessories", "Wall enclosure, mini-UPS, PoE injectors, antennas, cabling (allowance)", 1, 700),
]

services = [
    ("Site survey & FCU compatibility audit", "Check every FCU, thermostat wiring and voltage; confirm radio coverage", 1, 550),
    ("Thermostat replacement", "Licensed technician; remove old thermostat, install and wire new unit, test", N_TSTAT, 40),
    ("Sensor installation", "Mount and pair occupancy sensors", COMMON_FCU, 10),
    ("Gateway, edge & network installation", "Mount, power and connect gateways, router and edge controller", 1, 700),
    ("Commissioning & configuration", "Device onboarding, room mapping, schedules, setpoint limits, control logic", 1, 2000),
    ("Baseline & savings verification setup", "4-week baseline measurement and M&V method", 1, 800),
    ("Project management", "Scheduling with tenants and facility manager, reporting", 1, 800),
    ("Tenant communication & FM training", "Tenant notice, quick guide, facility-manager training session", 1, 400),
]

monthly = [
    ("Bohio AI optimisation platform", "Per controlled thermostat: AI scheduling, setpoint optimisation, dashboard, alerts", N_TSTAT, 5.5),
    ("Connectivity & remote monitoring", "4G data plan, VPN, 24/7 device health monitoring", 1, 40),
]

optional = [
    ("Occupancy sensors in flats", "WS202 in each flat living room for vacancy detection", FLATS, client_price(58.50) + 10),
    ("Balcony door contacts", "WS301; pause cooling when balcony door is left open", FLATS, client_price(63.19) + 10),
    ("Extended warranty (years 2-3)", "Hardware replacement and on-site visits", 1, 1200),
]

def total(rows):
    return sum(q * p for _, _, q, p in rows)

HW, SV, MO, OPT = total(hardware), total(services), total(monthly), total(optional)
ONE_OFF = HW + SV
VAT = 0.05

# ---------------- styles ----------------
NAVY = colors.HexColor("#1F3A5F")
LIGHT = colors.HexColor("#EEF2F7")
GREY = colors.HexColor("#6B7280")
s = lambda name, **kw: ParagraphStyle(name, fontName=kw.pop("font", "DV"), **kw)
H1 = s("h1", font="DVB", fontSize=20, leading=24, textColor=NAVY)
H2 = s("h2", font="DVB", fontSize=12.5, leading=16, textColor=NAVY, spaceBefore=10, spaceAfter=5)
B = s("b", fontSize=9, leading=12.5)
SM = s("sm", fontSize=7.8, leading=10, textColor=GREY)
CELL = s("c", fontSize=8.2, leading=10.5)
CELLB = s("cb", font="DVB", fontSize=8.2, leading=10.5)
CELLR = s("cr", fontSize=8.2, leading=10.5, alignment=TA_RIGHT)
CELLRB = s("crb", font="DVB", fontSize=8.2, leading=10.5, alignment=TA_RIGHT)
HDR = s("hdr", font="DVB", fontSize=8.2, leading=10.5, textColor=colors.white)
HDRR = s("hdrr", font="DVB", fontSize=8.2, leading=10.5, textColor=colors.white, alignment=TA_RIGHT)

aed = lambda v: f"${v:,.0f}" if float(v).is_integer() else f"${v:,.2f}"
P = Paragraph

def line_table(rows, unit_label="Unit price", total_label="Subtotal", per=""):
    data = [[P("#", HDR), P("Item", HDR), P("Qty", HDRR), P(unit_label, HDRR), P("Amount" + per, HDRR)]]
    for i, (item, desc, q, p) in enumerate(rows, 1):
        data.append([P(str(i), CELL),
                     P(f"<font name='DVB'>{item}</font><br/><font color='#6B7280' size='7.4'>{desc}</font>", CELL),
                     P(f"{q:,}", CELLR), P(aed(p), CELLR), P(aed(q * p), CELLR)])
    data.append(["", P(total_label, CELLB), "", "", P(aed(total(rows)), CELLRB)])
    t = Table(data, colWidths=[8*mm, 98*mm, 14*mm, 25*mm, 27*mm], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, LIGHT]),
        ("LINEABOVE", (0, -1), (-1, -1), 0.8, NAVY),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t

def kv_table(rows, widths, bold_last=True, shade=True):
    data = [[P(k, CELLB if (bold_last and i == len(rows) - 1) else CELL),
             P(v, CELLRB if (bold_last and i == len(rows) - 1) else CELLR)] for i, (k, v) in enumerate(rows)]
    t = Table(data, colWidths=widths)
    st = [("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
          ("LINEBELOW", (0, 0), (-1, -2), 0.3, colors.HexColor("#D1D5DB"))]
    if shade:
        st += [("BACKGROUND", (0, 0), (-1, -1), LIGHT)]
    if bold_last:
        st += [("LINEABOVE", (0, -1), (-1, -1), 0.8, NAVY)]
    t.setStyle(TableStyle(st))
    return t

def bullets(items):
    return [P(f"•&nbsp;&nbsp;{x}", s("bl", fontSize=8.6, leading=12, leftIndent=10, firstLineIndent=-8)) for x in items]

def on_page(c, doc):
    c.saveState()
    w, h = A4
    c.setFillColor(NAVY); c.rect(0, h - 14*mm, w, 14*mm, stroke=0, fill=1)
    c.setFillColor(colors.white); c.setFont("DVB", 11); c.drawString(18*mm, h - 9*mm, "BOHIO SYSTEMS")
    c.setFont("DV", 8); c.drawRightString(w - 18*mm, h - 9*mm, "Quotation BOH-Q-2026-001  |  DRAFT for review")
    c.setFillColor(GREY); c.setFont("DV", 7.5)
    c.drawString(18*mm, 10*mm, "Bohio Systems  |  AI HVAC optimisation  |  Prices in US dollars, excluding VAT unless stated")
    c.drawRightString(w - 18*mm, 10*mm, f"Page {doc.page}")
    c.restoreState()

# ---------------- document ----------------
doc = SimpleDocTemplate(__import__("os").path.join(__import__("os").path.dirname(__file__), "Bohio_Quote_HVAC_20_Flats_USD.pdf"), pagesize=A4,
                        leftMargin=18*mm, rightMargin=18*mm, topMargin=22*mm, bottomMargin=18*mm,
                        title="Bohio Systems - Quotation BOH-Q-2026-001", author="Bohio Systems")
st = []

st.append(P("Quotation", H1))
st.append(P("AI-driven HVAC optimisation: 5-storey residential building, 20 apartments", s("sub", fontSize=11, leading=15, textColor=GREY)))
st.append(Spacer(1, 6*mm))

meta = Table([
    [P("<font name='DVB'>Prepared for</font><br/>[Client name]<br/>[Building name, community, emirate]<br/>Attn: [Contact name, title]", B),
     P("<font name='DVB'>Quotation no.</font> BOH-Q-2026-001<br/><font name='DVB'>Date</font> 17 November 2026<br/>"
       "<font name='DVB'>Valid until</font> 17 December 2026<br/><font name='DVB'>Prepared by</font> Matteo Bevilacqua, Bohio Systems", B)]],
    colWidths=[87*mm, 87*mm])
meta.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
                          ("LEFTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 7),
                          ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
st.append(meta)

st.append(P("Summary", H2))
summary = [
    ("One-time: hardware", aed(HW)),
    ("One-time: installation & commissioning", aed(SV)),
    ("One-time total (excl. VAT)", aed(ONE_OFF)),
    ("VAT 5%", aed(ONE_OFF * VAT)),
    ("One-time total incl. VAT", aed(ONE_OFF * (1 + VAT))),
]
st.append(kv_table(summary, [120*mm, 54*mm]))
st.append(Spacer(1, 3*mm))
st.append(kv_table([("Monthly service fee (excl. VAT)", aed(MO) + " / month"),
                    ("Annual equivalent (excl. VAT)", aed(MO * 12) + " / year")], [120*mm, 54*mm]))
st.append(Spacer(1, 2*mm))
st.append(P(f"Per apartment: about {aed(ONE_OFF / FLATS)} one-time and {aed(MO / FLATS)} per month "
            f"(common areas shared across the 20 apartments). Minimum service term 24 months.", SM))

st.append(P("What you get", H2))
st += bullets([
    f"Every fan coil unit ({N_TSTAT} in total: {FCU_PER_FLAT} per apartment plus {COMMON_FCU} in lobby and corridors) gets a connected thermostat that Bohio's AI can schedule and optimise, while tenants keep local control.",
    "Automatic setback when spaces are empty, pre-cooling before typical arrival times, setpoint limits (e.g. no cooling below 22 °C) and alerts for units running overnight or faulty.",
    "Wireless retrofit: no new cabling through occupied apartments and no dependence on building IT.",
    "Safe by design: if the internet or Bohio's platform is unavailable, every thermostat keeps running on its local schedule and manual control.",
    "Monthly savings report based on the building's district-cooling BTU meter, measured against a 4-week baseline.",
])

st.append(PageBreak())
st.append(P("1. Hardware", H2))
st.append(line_table(hardware, total_label="Hardware subtotal"))
st.append(Spacer(1, 2*mm))
st.append(P("Allowance items are estimates and will be fixed after the site survey. Hardware carries a 12-month warranty.", SM))

st.append(P("2. Installation & commissioning", H2))
st.append(line_table(services, total_label="Services subtotal"))

st.append(KeepTogether([P("3. Monthly service", H2),
                        line_table(monthly, unit_label="Monthly rate", total_label="Monthly total", per=" / mo"),
                        Spacer(1, 2*mm),
                        P("Includes software updates, cloud hosting, savings reporting and remote support during "
                          "business hours. On-site visits after the warranty period are charged separately.", SM)]))

st.append(KeepTogether([P("4. Optional items (not included in totals)", H2), line_table(optional, total_label="Optional items total")]))

st.append(PageBreak())
st.append(P("5. Indicative savings", H2))
st.append(P("Bohio targets a 15-25% reduction in cooling energy for the controlled units, from scheduling, "
            "vacancy setback and setpoint limits. Actual savings depend on occupancy, tenant behaviour, building "
            "condition and the district-cooling tariff, and are <font name='DVB'>not guaranteed</font>. They will be "
            "measured monthly against the baseline using the building's BTU meter, and reported transparently.", B))

st.append(P("6. Project timeline", H2))
tl = [("Week 1", "Site survey and FCU compatibility audit; final quote confirmed"),
      ("Weeks 2-4", "Hardware procurement and delivery"),
      ("Weeks 3-6", "Baseline measurement (in parallel)"),
      ("Weeks 5-6", "Installation floor by floor (about 1 floor per day), tenant appointments"),
      ("Week 7", "Commissioning, shadow mode, facility-manager training"),
      ("Week 8", "Optimisation live; first savings report after month 1")]
t = Table([[P(a, CELLB), P(b, CELL)] for a, b in tl], colWidths=[28*mm, 146*mm])
t.setStyle(TableStyle([("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, LIGHT]),
                       ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
st.append(t)

st.append(P("7. Payment terms", H2))
st += bullets([
    f"50% of the one-time total on order ({aed(ONE_OFF * 0.5)} + VAT).",
    f"40% on completion of installation ({aed(ONE_OFF * 0.4)} + VAT).",
    f"10% on commissioning sign-off ({aed(ONE_OFF * 0.1)} + VAT).",
    "Monthly service fee invoiced monthly in advance from go-live; minimum term 24 months.",
    "All prices in US dollars. UAE VAT at 5% added to all invoices.",
])

st.append(P("8. Assumptions", H2))
st += bullets([
    "Building is G+4 (5 storeys) with 20 apartments of 1-2 bedrooms; 3 fan coil units per apartment and 7 in common areas.",
    "Cooling by chilled-water fan coil units (district cooling or central plant) with standard 230 V wall thermostats controlling fan speed and a valve. Split-unit or VRF buildings need a different quote.",
    "Existing thermostat wiring is reusable; FCU valves and fans are in working order.",
    "Access to each apartment can be arranged with tenants during normal working hours.",
    "A BTU meter with an accessible data port serves the building; a power socket is available at the gateway location.",
    "Radio coverage from two gateways is sufficient; confirmed during the site survey.",
])

st.append(P("9. Exclusions", H2))
st += bullets([
    "Repair or replacement of faulty FCUs, valves, actuators or wiring found during the survey (quoted separately).",
    "Civil works, painting or making good beyond the thermostat footprint.",
    "District-cooling provider fees, approvals or changes to the provider's metering.",
    "Any guarantee of savings, unless agreed under a separate performance contract.",
])

st.append(KeepTogether([
    P("10. Acceptance", H2),
    P("Signing below accepts this quotation, subject to confirmation of quantities and allowances after the site survey.", B),
    Spacer(1, 8*mm),
    Table([[P("For the client<br/><br/><br/>Name / signature / date<br/>________________________________", B),
            P("For Bohio Systems<br/><br/><br/>Name / signature / date<br/>________________________________", B)]],
          colWidths=[87*mm, 87*mm]),
]))

doc.build(st, onFirstPage=on_page, onLaterPages=on_page)

print(f"thermostats={N_TSTAT} HW={HW:,} SV={SV:,} ONE_OFF={ONE_OFF:,} VAT={ONE_OFF*VAT:,.0f} "
      f"incl={ONE_OFF*1.05:,.0f} MONTHLY={MO:,} ANNUAL={MO*12:,} OPT={OPT:,} per_flat={ONE_OFF/FLATS:,.0f}")
for name, rows in (("HW", hardware), ("SV", services), ("MO", monthly), ("OPT", optional)):
    for item, _, q, p in rows:
        print(f"  {name}: {item}: {q} x {p} = {q*p:,}")
