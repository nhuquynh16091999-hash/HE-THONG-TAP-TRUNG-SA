---
paths:
  - "faos_brain/**/*.py"
  - "tests/**/*.py"
  - "sync/**/*.py"
  - "scripts/**/*.py"
---
# Python Conventions — FAOS v6

## Code Structure
- Max **300 dong/file**. Neu vuot -> dung Extract-Delegate-Reexport pattern
- Max **30 dong/function**. Neu vuot -> tach helper
- Moi file phai co module-level docstring giai thich muc dich

## Typing & Docstrings
- **Type hints BAT BUOC** cho function params va return
- Docstrings cho public functions (Google style)
- Dung `Optional[T]` thay vi `T | None` (Python 3.9 compat)

## Error Handling
- KHONG dung bare `except:` — luon specify exception type
- LLM calls: luon co fallback chain (Gemini -> GPT -> Error)
- BigQuery queries: luon co timeout va error handling

## Import Rules
- Standard lib -> Third party -> Local imports (isort order)
- Lazy import cho circular dependency (runner.py <-> runner_cli.py)
- Re-export tu file goc khi tach module (backward compat)

## Naming
- Classes: PascalCase (`ExecutiveAnalyst`, `MarketingDirector`)
- Functions/variables: snake_case (`analyze_campaign`, `daily_report`)
- Constants: UPPER_SNAKE_CASE (`MAX_RETRIES`, `DEFAULT_TIMEOUT`)
- Files: snake_case (`analyst_parser.py`, `director_approval.py`)

## Testing
- Moi module moi PHAI co test tuong ung trong `tests/`
- Test file naming: `test_{module_name}.py`
- Dung pytest fixtures, KHONG dung unittest.TestCase
