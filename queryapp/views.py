import json
import re
import time
from decimal import Decimal

from django.conf import settings
from django.db import connection
from django.db.models import F
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_POST
from django.views.decorators.csrf import ensure_csrf_cookie

from google import genai
from google.genai import types

from .models import QueryLog, APIUsage
import sqlite3
from datetime import datetime
from zoneinfo import ZoneInfo


DB_PATH = str(settings.DATABASES['default']['NAME'])

ALLOWED_TABLES = {
    "employees",
    "departments",
    "salaries"
}

TABLE_REF = re.compile(
    r"\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*)",
    re.IGNORECASE
)


def uses_allowed_tables(sql: str) -> bool:
    referenced = TABLE_REF.findall(sql)

    return (
        len(referenced) > 0
        and all(t.lower() in ALLOWED_TABLES for t in referenced)
    )


def get_readonly_connection():
    # mode=ro opens the SQLite file such that write attempts fail
    # at the database layer itself.
    return sqlite3.connect(
        f"file:{DB_PATH}?mode=ro",
        uri=True
    )


# ---------------------------------------------------------
# Gemini setup
# ---------------------------------------------------------

GEMINI_MODEL = "gemini-3.5-flash-lite"

_client = None


def get_client():
    global _client

    if _client is None:
        _client = genai.Client(
            api_key=settings.GEMINI_API_KEY
        )

    return _client


# ---------------------------------------------------------
# Schema context
# ---------------------------------------------------------

SCHEMA_CONTEXT = """Tables (SQLite):
departments(id, name)
employees(id, name, department_id -> departments.id)
salaries(id, employee_id -> employees.id, amount, effective_date)

Rules: Output ONE SELECT statement only. No INSERT/UPDATE/DELETE/DROP/ALTER/PRAGMA/ATTACH. No semicolons, no comments. Use only the tables/columns above. Always alias every selected column with a short snake_case name (e.g. department_name, avg_salary) so results have readable headers.
Reply with compact JSON only: {"sql": "...", "explanation": "..."} — explanation under 12 words, no markdown."""


# ---------------------------------------------------------
# SQL safety
# ---------------------------------------------------------

FORBIDDEN = re.compile(
    r"\b(insert|update|delete|drop|alter|truncate|create|grant|attach|pragma|replace)\b",
    re.IGNORECASE,
)


def is_safe_select(sql: str) -> bool:

    sql_stripped = sql.strip().rstrip(";").strip()

    if not sql_stripped.lower().startswith("select"):
        return False

    if ";" in sql_stripped:
        return False

    if "--" in sql_stripped or "/*" in sql_stripped or "*/" in sql_stripped:
        return False

    if FORBIDDEN.search(sql_stripped):
        return False

    return True


# ---------------------------------------------------------
# Feature 1: API Usage Meter
# ---------------------------------------------------------

PACIFIC_TZ = ZoneInfo("America/Los_Angeles")


def record_gemini_usage():

    today = datetime.now(PACIFIC_TZ).date()

    usage, created = APIUsage.objects.get_or_create(
        date=today,
        defaults={"count": 0},
    )

    APIUsage.objects.filter(pk=usage.pk).update(
        count=F("count") + 1
    )


def ask_gemini(prompt: str) -> dict:

    response = get_client().models.generate_content(
        model=GEMINI_MODEL,
        contents=prompt,
       config=types.GenerateContentConfig(
    system_instruction=SCHEMA_CONTEXT,
    response_mime_type="application/json",
    max_output_tokens=250,
    thinking_config=types.ThinkingConfig(
        thinking_level="minimal"
    ),
  ),
)

    # Feature 1:
    # Count every successful Gemini API call.
    record_gemini_usage()

    return json.loads(response.text)


# ---------------------------------------------------------
# Views
# ---------------------------------------------------------

@ensure_csrf_cookie
def index(request):
    return render(
        request,
        "queryapp/index.html"
    )


# ---------------------------------------------------------
# Generate SQL
# ---------------------------------------------------------

@require_POST
@csrf_protect
def generate_query(request):

    body = json.loads(request.body)

    transcript = body.get(
        "transcript",
        ""
    ).strip()

    if not transcript:
        return JsonResponse(
            {"error": "No transcript received."},
            status=400
        )

    cached = (
        QueryLog.objects
        .filter(normalized_transcript=QueryLog.normalize(transcript), was_confirmed=True)
        .order_by('-created_at')
        .first()
    )
    if cached:
        return JsonResponse({
            "sql": cached.generated_sql,
            "explanation": "Reused from a previously confirmed query.",
        })

    try:
        result = ask_gemini(
            f'The user asked, by voice: "{transcript}"'
        )

    except Exception as e:

        return JsonResponse(
            {
                "error": f"Could not generate a query: {e}"
            },
            status=502
        )

    sql = result.get(
        "sql",
        ""
    )

    if not is_safe_select(sql):

        return JsonResponse(
            {
                "error": "Generated query failed the safety check."
            },
            status=400
        )

    return JsonResponse(
        {
            "sql": sql,
            "explanation": result.get(
                "explanation",
                ""
            ),
        }
    )


# ---------------------------------------------------------
# Revise SQL
# ---------------------------------------------------------

@require_POST
@csrf_protect
def revise_query(request):

    body = json.loads(request.body)

    previous_sql = body.get(
        "previous_sql",
        ""
    )

    correction = body.get(
        "correction",
        ""
    ).strip()

    if not correction:

        return JsonResponse(
            {
                "error": "No correction received."
            },
            status=400
        )

    prompt = (
        f"You previously wrote this SQL:\n{previous_sql}\n\n"
        f"The user said that was NOT what they meant. "
        f'Their correction: "{correction}"\n'
        f"Write a new SELECT statement that fixes this."
    )

    try:
        result = ask_gemini(prompt)

    except Exception as e:

        return JsonResponse(
            {
                "error": f"Could not revise the query: {e}"
            },
            status=502
        )

    sql = result.get(
        "sql",
        ""
    )

    if not is_safe_select(sql):

        return JsonResponse(
            {
                "error": "Revised query failed the safety check."
            },
            status=400
        )

    return JsonResponse(
        {
            "sql": sql,
            "explanation": result.get(
                "explanation",
                ""
            ),
        }
    )


# ---------------------------------------------------------
# Run SQL
# ---------------------------------------------------------

@require_POST
@csrf_protect
def run_query(request):
    body = json.loads(request.body)

    sql = body.get("sql", "")
    transcript = body.get("transcript", "")
    correction = body.get("correction", "")

    if not is_safe_select(sql):
        return JsonResponse(
            {"error": "Query failed the safety check and was not run."},
            status=400
        )

    if not uses_allowed_tables(sql):
        return JsonResponse(
            {"error": "Query references a table outside the allowed schema."},
            status=400
        )

    try:
        start_time = time.perf_counter()

        conn = get_readonly_connection()
        cursor = conn.cursor()

        cursor.execute(sql)

        columns = [col[0] for col in cursor.description]
        rows = cursor.fetchmany(200)

        response_time_ms = round(
            (time.perf_counter() - start_time) * 1000,
            2
        )

        conn.close()

    except Exception as e:
        return JsonResponse(
            {"error": f"Query failed to run: {e}"},
            status=400
        )

    def clean(v):
        return float(v) if isinstance(v, Decimal) else v

    rows = [[clean(v) for v in row] for row in rows]

    QueryLog.objects.create(
        raw_transcript=transcript,
        generated_sql=sql,
        was_confirmed=True,
        correction_text=correction or None,
        row_count=len(rows),
        response_time_ms=response_time_ms,
    )

    return JsonResponse({
        "columns": columns,
        "rows": rows,
        "row_count": len(rows),
        "response_time_ms": response_time_ms,
    })

    
    # -----------------------------------------------------
    # Safety checks
    # -----------------------------------------------------

    if not is_safe_select(sql):

        return JsonResponse(
            {
                "error": "Query failed the safety check and was not run."
            },
            status=400
        )

    if not uses_allowed_tables(sql):

        return JsonResponse(
            {
                "error": "Query references a table outside the allowed schema."
            },
            status=400
        )

    # -----------------------------------------------------
    # Task 2: Start response-time timer
    # -----------------------------------------------------

    start_time = time.perf_counter()

    try:

        conn = get_readonly_connection()

        cursor = conn.cursor()

        cursor.execute(sql)

        columns = [
            col[0]
            for col in cursor.description
        ]

        rows = cursor.fetchmany(200)

        conn.close()

        # -------------------------------------------------
        # Task 2: Calculate response time
        # -------------------------------------------------

        response_time_ms = round(
            (time.perf_counter() - start_time) * 1000,
            2
        )

    except Exception as e:

        return JsonResponse(
            {
                "error": f"Query failed to run: {e}"
            },
            status=400
        )

    # -----------------------------------------------------
    # Convert Decimal values for JSON
    # -----------------------------------------------------

    def clean(v):

        if isinstance(v, Decimal):
            return float(v)

        return v

    rows = [
        [
            clean(v)
            for v in row
        ]
        for row in rows
    ]

    # -----------------------------------------------------
    # Save query log
    # -----------------------------------------------------

    QueryLog.objects.create(
        raw_transcript=transcript,
        generated_sql=sql,
        was_confirmed=True,
        correction_text=correction or None,
        row_count=len(rows),

        # Task 2:
        # Store how long the query took.
        response_time_ms=response_time_ms,
    )

    # -----------------------------------------------------
    # Return results + response time to frontend
    # -----------------------------------------------------

    return JsonResponse(
        {
            "columns": columns,
            "rows": rows,
            "row_count": len(rows),

            # Task 2:
            # Send response time to frontend.
            "response_time_ms": response_time_ms,
        }
    )


# ---------------------------------------------------------
# Feature 1: API Usage endpoint
# ---------------------------------------------------------

def api_usage(request):

    today = datetime.now(
        PACIFIC_TZ
    ).date()

    usage = APIUsage.objects.filter(
        date=today
    ).first()

    count = usage.count if usage else 0

    return JsonResponse(
        {
            "count": count,
        }
    )