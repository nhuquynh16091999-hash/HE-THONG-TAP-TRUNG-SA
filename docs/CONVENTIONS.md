# Coding Conventions: AUUS (FAOS v6)

## Naming Rules
### Python (Backend / AI Core)
| Loai | Convention | Vi du |
|------|-----------|-------|
| Variables | snake_case | user_name, is_active |
| Functions | snake_case | get_user_by_id() |
| Classes | PascalCase | FAOSSettings, AnalystAgent |
| Files | snake_case | llm_client.py, state_machine.py |
| Constants | UPPER_SNAKE | MAX_RETRY, DEFAULT_ROAS |

### TypeScript (Frontend / Dashboard)
| Loai | Convention | Vi du |
|------|-----------|-------|
| Variables | camelCase | userName, isActive |
| Functions | camelCase | getUserById() |
| Components | PascalCase | LiveFeed, AuditHistory |
| Files | kebab-case | live-feed.tsx, audit-history.tsx |
| Constants | UPPER_SNAKE | MAX_RETRY |

## File Organization
- Moi file toi da 300 dong
- Moi function toi da 30 dong
- Python: Group by module (faos_brain/api/, faos_brain/models/)
- Frontend: Group by feature (dashboard-ui/src/app/)

## Git Conventions
- Branch: feature/(name), fix/(name)
- Commit: feat:, fix:, refactor:, docs:, test:, chore:

## Python Specifics
- PEP8 compliant
- Type hints required for all public functions
- Pydantic models for all data structures
- Docstrings: Google style

## TypeScript Specifics
- Strict mode enabled
- Tailwind CSS for styling
- Server Components (Next.js 15) by default
