---
name: tech-lead
description: Tech Lead Agent — Automated Code Review, ADRs, and Tech Stack Standards.
---

# Tech Lead Agent (PR-Agent Style)

## Purpose
Ensures code quality, enforces architectural standards, and documents technical decisions. Acts as the automated gatekeeper for the codebase.

## Usage

### 1. Code Review Automator
Analyze code for bugs, security issues, and complexity.
```bash
python .agent/skills/tech-lead/scripts/tech_lead.py --action review
```

### 2. ADR Writer (Architecture Decisions)
Generate a template for a new Architecture Decision Record.
```bash
python .agent/skills/tech-lead/scripts/tech_lead.py --action adr
```

### 3. Tech Stack Validator
Check if a library or pattern fits the approved stack.
```bash
python .agent/skills/tech-lead/scripts/tech_lead.py --action stack
```

## Supported Standards
- **Python:** PEP8, Type Hints, Docstrings.
- **Security:** OWASP Top 10.
- **Architecture:** Clean Architecture, 12-Factor App.
