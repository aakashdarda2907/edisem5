import json
import re
from decimal import Decimal

from django.conf import settings
from django.db import connection
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_POST
from django.views.decorators.csrf import ensure_csrf_cookie

from google import genai
from google.genai import types

from .models import QueryLog
import sqlite3

DB_PATH = str(settings.DATABASES['default']['NAME'])
ALLOWED_TABLES = {"employees", "departments", "salaries"}
TABLE_REF = re.compile(r"\b(?:from|join|update|into)\s+([a-zA-Z_][a-zA-Z0-9_]*)", re.IGNORECASE)

def uses_allowed_tables(sql: str) -> bool:
    referenced = TABLE_REF.findall(sql)
    return len(referenced) > 0 and all(t.lower() in ALLOWED_TABLES for t in referenced)


def get_readonly_connection():
    # mode=ro opens the SQLite file such that write attempts fail at the
    # database layer itself, regardless of what the query text says.
    return sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)

# --- Gemini setup ---
# Double-check this model name against Google's current docs before relying on it —
# model names/versions change often.
GEMINI_MODEL = "gemini-3.5-flash"

_client = None
def get_client():
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.GEMINI_API_KEY)
    return _client

# --- Schema context we hand to Gemini every time ---
SCHEMA_CONTEXT = """Tables (SQLite):
departments(id, name)
employees(id, name, department_id -> departments.id)
salaries(id, employee_id -> employees.id, amount, effective_date)

Rules:
1. Output ONE SELECT statement OR ONE whitelisted write statement (UPDATE, INSERT, DELETE) on the allowed tables.
2. Whitelisted writes: UPDATE, INSERT, or DELETE queries modifying in-scope tables.
3. Strictly FORBIDDEN: DROP, ALTER, TRUNCATE, CREATE, GRANT, ATTACH, PRAGMA, REPLACE.
4. No semicolons, no comments.
5. Reply with compact JSON: {"sql": "...", "query_type": "read" | "write", "explanation": "..."} — explanation under 12 words, no markdown."""


# --- Safety check applied to every piece of SQL before it is run ---
FORBIDDEN = re.compile(
    r"\b(insert|update|delete|drop|alter|truncate|create|grant|attach|pragma|replace)\b",
    re.IGNORECASE,
)

WRITE_FORBIDDEN = re.compile(
    r"\b(drop|alter|truncate|create|grant|attach|pragma|replace)\b",
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

def is_safe_write(sql: str) -> bool:
    sql_stripped = sql.strip().rstrip(";").strip()
    
    # Allow UPDATE, INSERT, and DELETE statements
    if not sql_stripped.lower().startswith(("update", "insert", "delete")):
        return False
        
    if ";" in sql_stripped or "--" in sql_stripped or "/*" in sql_stripped or "*/" in sql_stripped:
        return False
        
    if WRITE_FORBIDDEN.search(sql_stripped):
        return False
        
    return True



def ask_gemini(prompt: str) -> dict:
    response = get_client().models.generate_content(
        model=GEMINI_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=SCHEMA_CONTEXT,
            response_mime_type="application/json",
            max_output_tokens=250,
            temperature=0,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        ),
    )
    return json.loads(response.text)


# --- Views ---

@ensure_csrf_cookie
def index(request):
    return render(request, "queryapp/index.html")


@require_POST
@csrf_protect
def generate_query(request):
    body = json.loads(request.body)
    transcript = body.get("transcript", "").strip()

    if not transcript:
        return JsonResponse({"error": "No transcript received."}, status=400)

    try:
        result = ask_gemini(f"The user asked, by voice: \"{transcript}\"")
    except Exception as e:
        return JsonResponse({"error": f"Could not generate query: {e}"}, status=502)

    sql = result.get("sql", "")
    query_type = result.get("query_type", "read")

    if not (is_safe_select(sql) or is_safe_write(sql)):
        return JsonResponse({"error": "Generated query failed write/select safety check."}, status=400)

    return JsonResponse({
        "sql": sql,
        "query_type": query_type,
        "explanation": result.get("explanation", ""),
    })


@require_POST
@csrf_protect
def revise_query(request):
    body = json.loads(request.body)
    previous_sql = body.get("previous_sql", "")
    correction = body.get("correction", "").strip()

    if not correction:
        return JsonResponse({"error": "No correction received."}, status=400)

    prompt = (
        f"You previously wrote this SQL:\n{previous_sql}\n\n"
        f"The user said that was NOT what they meant. Their correction: \"{correction}\"\n"
        f"Write a new SELECT or whitelisted UPDATE statement fixing this."
    )

    try:
        result = ask_gemini(prompt)
    except Exception as e:
        return JsonResponse({"error": f"Could not revise the query: {e}"}, status=502)

    sql = result.get("sql", "")
    query_type = result.get("query_type", "read")

    if not (is_safe_select(sql) or is_safe_write(sql)):
        return JsonResponse({"error": "Revised query failed write/select safety check."}, status=400)

    return JsonResponse({
        "sql": sql,
        "query_type": query_type,
        "explanation": result.get("explanation", ""),
    })


@require_POST
@csrf_protect
def run_query(request):
    body = json.loads(request.body)
    sql = body.get("sql", "")
    transcript = body.get("transcript", "")
    correction = body.get("correction", "")

    is_select = is_safe_select(sql)
    is_write = is_safe_write(sql)

    if not (is_select or is_write):
        return JsonResponse({"error": "Query failed safety check and was blocked."}, status=400)
    if not uses_allowed_tables(sql):
        return JsonResponse({"error": "Query references an unauthorized table."}, status=400)

    try:
        if is_select:
            conn = get_readonly_connection()
            cursor = conn.cursor()
            cursor.execute(sql)
            columns = [col[0] for col in cursor.description] if cursor.description else []
            rows = cursor.fetchmany(200)
            conn.close()
            rows = [[float(v) if isinstance(v, Decimal) else v for v in r] for r in rows]
            row_count = len(rows)
        else:
            # Execute write on standard writable SQLite connection
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute(sql)
            conn.commit()
            row_count = cursor.rowcount
            conn.close()
            columns = ["status", "rows_updated"]
            rows = [["Success", row_count]]

    except Exception as e:
        return JsonResponse({"error": f"Execution failed: {e}"}, status=400)

    QueryLog.objects.create(
        raw_transcript=transcript,
        generated_sql=sql,
        was_confirmed=True,
        correction_text=correction or None,
        row_count=row_count,
    )

    return JsonResponse({"columns": columns, "rows": rows, "row_count": row_count, "query_type": "write" if is_write else "read"})