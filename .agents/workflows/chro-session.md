---
description: CHRO Session Protocol — Read at start, update at end of every session
---

# CHRO Session Protocol

## At Session Start (MANDATORY)
// turbo
1. Read the CHRO Briefing to understand current system state:
```
agents/chro/CHRO_BRIEFING.md
```

// turbo
2. Read the Decision Log for context on past decisions:
```
agents/chro/CHRO_DECISION_LOG.md
```

// turbo
3. Read the Agent Scorecards for current training progress:
```
agents/chro/agent_scorecards.json
```

// turbo
4. Read the Task Tracker for what's in progress:
```
Check the latest task.md artifact
```

5. Confirm readiness to the user:
```
Report: "CHRO đã đọc xong brief. Hiện tại [summary]. Ưu tiên tiếp theo: [priority]."
```

## At Session End (MANDATORY)
6. Update `agents/chro/CHRO_BRIEFING.md` with:
   - What was accomplished this session
   - Any new issues discovered
   - Updated agent status
   - Updated priorities for next session

7. Update `agents/chro/CHRO_DECISION_LOG.md` with any new decisions made

8. Update `agents/chro/agent_scorecards.json` if any agent training progress changed

## During Session
- When making architectural decisions: add entry to Decision Log
- When completing agent training modules: update both Scorecards and Briefing
- When user asks "tình hình thế nào?": refer to Briefing for instant answer
