---
name: project-manager
description: Agile Project Manager Agent — Transforms ideas into PRDs, User Stories, and Sprint Plans.
---

# Project Manager Agent (MetaGPT Style)

## Purpose
Acts as the bridge between Business and Tech. Converts high-level business requirements into technical specifications and actionable tasks.

## Usage

### 1. PRD Generator
Create a structured Product Requirement Document from a one-line idea.
```bash
python .agent/skills/project-manager/scripts/pm.py --action prd
```

### 2. User Story Mapper
Break down PRD features into User Stories with Acceptance Criteria (Gherkin).
```bash
python .agent/skills/project-manager/scripts/pm.py --action stories
```

### 3. Sprint Planner
Organize stories into sprints based on complexity and team capacity.
```bash
python .agent/skills/project-manager/scripts/pm.py --action sprint
```

## Key Metrics
- **Velocity:** Story points per sprint.
- **Scope Creep:** % of new stories added mid-sprint.
