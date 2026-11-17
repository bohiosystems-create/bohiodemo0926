# Quoting tools

| File | What it is |
|---|---|
| `index.html` | Interactive quoting wizard (single file, no build step). Open it in a browser. |
| `build_quote.py` | Builds the 20-flat PDF quote (`pip install reportlab`). |
| `build_map.py` | Builds the one-page A3 quoting map PDF from `routes_usd.json`. |
| `routes_usd.json` | Route prices (A1–E1) for the reference building, exported from the wizard's pricing model. |

## Run the wizard locally
```bash
python3 -m http.server 8000 --directory quoting   # then open http://localhost:8000
```

## Where the pricing lives
All pricing is in `index.html` between the `/*CALC*/` and `/*ENDCALC*/` markers:
- `USD` – online cost prices per device (USD)
- `P0` – margin, shipping/customs, labour rates, platform fee, allowances
- `TYPES` / `SENSE` – building types, default sizes and occupancy-sensor logic
- `price(code, state, params)` – returns line items and totals for a route

To test pricing without a browser:
```bash
node -e "$(sed -n '/\/\*CALC\*\//,/\/\*ENDCALC\*\//p' quoting/index.html); \
console.log(price('B2',{btype:'apartment',cooling:'dc',flats:20,perFlat:3,common:7,floors:5},P0).one)"
# expected: 22694
```

Note: `routes_usd.json` and the PDF scripts are snapshots. If you change prices in the wizard, regenerate the JSON and PDFs.
