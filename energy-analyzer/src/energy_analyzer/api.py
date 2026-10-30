"""HTTP API.

POST /analyze        multipart: site (JSON config), interval (file), bills (files), weather (optional CSV)
POST /bills/extract  multipart: file (bill PDF) -> structured bill data via Claude
GET  /health
"""

from __future__ import annotations

import io
import json
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse
from pydantic import ValidationError

from . import __version__, llm
from .bills import BillExtraction, load_bills_csv
from .ingest.interval import IntervalDataError, load_interval_file
from .models import Report
from .pipeline import analyze
from .report import to_markdown
from .service import config_from_dict, load_weather_csv, weather_for

app = FastAPI(title="Energy Analyzer", version=__version__)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "version": __version__, "claude": llm.claude_available()}


@app.post("/analyze", response_model=Report)
async def analyze_endpoint(
    site: Annotated[str, Form(description="Site config as JSON")],
    interval: Annotated[UploadFile | None, File()] = None,
    bills: Annotated[list[UploadFile] | None, File()] = None,
    weather: Annotated[UploadFile | None, File(description="Optional CSV: utc timestamp, temp_c. Otherwise Open-Meteo.")] = None,
    use_claude: Annotated[bool, Form()] = True,
):
    try:
        config = config_from_dict(json.loads(site))
    except (json.JSONDecodeError, ValidationError) as e:
        raise HTTPException(422, f"Invalid site config: {e}") from e

    kwh = None
    if interval is not None:
        try:
            kwh = load_interval_file(await interval.read(), config.timezone, interval.filename)
        except (IntervalDataError, ValueError) as e:
            raise HTTPException(422, f"Could not read interval data: {e}") from e

    bill_list, notes = [], []
    for upload in bills or []:
        raw = await upload.read()
        name = (upload.filename or "").lower()
        if name.endswith(".csv"):
            bill_list += load_bills_csv(io.BytesIO(raw))
        elif name.endswith(".pdf"):
            try:
                extraction = llm.extract_bills_from_pdf(raw)
            except llm.ClaudeError as e:
                raise HTTPException(502, f"Bill extraction failed for {upload.filename}: {e}") from e
            bill_list += extraction.bills
            notes += [f"{upload.filename}: {n}" for n in extraction.notes]
        else:
            raise HTTPException(422, f"Unsupported bill file {upload.filename} (use PDF or CSV)")

    if kwh is None and not bill_list:
        raise HTTPException(422, "Provide interval data, bills, or both")
    temp = load_weather_csv(io.BytesIO(await weather.read()), config.timezone) if weather else weather_for(config, kwh, bill_list)
    try:
        report = analyze(config, temp, kwh, bill_list, use_claude=use_claude and llm.claude_available())
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    report.warnings += notes
    return report


@app.post("/analyze/markdown", response_class=PlainTextResponse)
async def analyze_markdown(report: Report) -> str:
    """Render a Report (as returned by /analyze) to Markdown."""
    return to_markdown(report)


@app.post("/bills/extract", response_model=BillExtraction)
async def extract_bill(file: Annotated[UploadFile, File()]):
    if not llm.claude_available():
        raise HTTPException(503, "ANTHROPIC_API_KEY is not configured")
    try:
        return llm.extract_bills_from_pdf(await file.read())
    except llm.ClaudeError as e:
        raise HTTPException(502, str(e)) from e
