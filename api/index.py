"""
Vercel Python Serverless Function entrypoint.

This simply imports the existing FastAPI ASGI app from backend/server.py so
Vercel can run it directly as a serverless function — no separate Render
backend needed. Vercel's Python runtime natively supports ASGI apps exported
as a module-level `app` variable.
"""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from server import app  # noqa: E402  (re-exported for Vercel's Python runtime)
