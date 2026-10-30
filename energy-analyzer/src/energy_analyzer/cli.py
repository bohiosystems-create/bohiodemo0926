"""Command line: `energy-analyzer analyze ...`, `energy-analyzer demo`, `energy-analyzer serve`."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .ingest.interval import load_interval_file
from .pipeline import analyze
from .report import to_markdown


def _write(report, out: Path | None) -> None:
    md = to_markdown(report)
    if out is None:
        sys.stdout.write(md)
        return
    out.mkdir(parents=True, exist_ok=True)
    (out / "report.md").write_text(md)
    (out / "report.json").write_text(report.model_dump_json(indent=2))
    print(f"Wrote {out / 'report.md'} and {out / 'report.json'}")


def cmd_analyze(args) -> None:
    from .service import load_bill_files, load_site_config, load_weather_csv, weather_for

    config = load_site_config(args.site)
    kwh = load_interval_file(args.interval, config.timezone) if args.interval else None
    bills, notes = load_bill_files(args.bills or [])
    temp = load_weather_csv(args.weather, config.timezone) if args.weather else weather_for(config, kwh, bills)
    report = analyze(config, temp, kwh, bills, use_claude=False if args.no_claude else None)
    report.warnings += notes
    _write(report, args.out)


def cmd_demo(args) -> None:
    from .sample_data import sample_building, sample_config

    kwh, temp = sample_building()
    if args.write_inputs:
        args.write_inputs.mkdir(parents=True, exist_ok=True)
        kwh.tz_convert("UTC").rename_axis("timestamp").reset_index().to_csv(args.write_inputs / "interval.csv", index=False)
        temp.tz_convert("UTC").rename_axis("timestamp").reset_index().to_csv(args.write_inputs / "weather.csv", index=False)
        print(f"Wrote sample inputs to {args.write_inputs}")
    report = analyze(sample_config(), temp, kwh, use_claude=False if args.no_claude else None)
    _write(report, args.out)


def cmd_extract_bill(args) -> None:
    from . import llm

    print(json.dumps(llm.extract_bills_from_pdf(Path(args.pdf).read_bytes()).model_dump(mode="json"), indent=2))


def cmd_serve(args) -> None:
    import uvicorn

    uvicorn.run("energy_analyzer.api:app", host=args.host, port=args.port)


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="energy-analyzer", description=__doc__)
    sub = p.add_subparsers(required=True)

    a = sub.add_parser("analyze", help="Analyze a site")
    a.add_argument("--site", required=True, type=Path, help="Site config (.toml or .json)")
    a.add_argument("--interval", type=Path, help="Interval data: CSV or Green Button XML/CSV")
    a.add_argument("--bills", nargs="*", type=Path, help="Bill PDFs (read by Claude) or a bills CSV")
    a.add_argument("--weather", type=Path, help="Hourly temperature CSV (timestamp, temp_c); default: Open-Meteo")
    a.add_argument("--out", type=Path, help="Output directory (default: Markdown to stdout)")
    a.add_argument("--no-claude", action="store_true", help="Template narrative, no API calls")
    a.set_defaults(func=cmd_analyze)

    d = sub.add_parser("demo", help="Run on a synthetic building with known waste")
    d.add_argument("--out", type=Path)
    d.add_argument("--no-claude", action="store_true")
    d.add_argument("--write-inputs", type=Path, help="Also save the synthetic interval and weather CSVs here")
    d.set_defaults(func=cmd_demo)

    e = sub.add_parser("extract-bill", help="Extract structured data from a bill PDF with Claude")
    e.add_argument("pdf", type=Path)
    e.set_defaults(func=cmd_extract_bill)

    s = sub.add_parser("serve", help="Run the HTTP API")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8000)
    s.set_defaults(func=cmd_serve)

    args = p.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
