# Antigravity Tool Mapping

Skills use Claude Code tool names. When you encounter these in a skill, use your Antigravity equivalent:

| Skill references | Antigravity equivalent |
|-----------------|----------------------|
| `Read` (file reading) | `view_file` |
| `Write` (file creation) | `write_to_file` |
| `Edit` (file editing) | `replace_file_content` / `multi_replace_file_content` |
| `Bash` (run commands) | `run_command` |
| `Grep` (search file content) | `grep_search` |
| `Glob` (search files by name) | `find_by_name` |
| `TodoWrite` (task tracking) | Artifact `task.md` with checklist format |
| `Skill` tool (invoke a skill) | `view_file` on `SKILL.md` in `.agent/skills/` |
| `WebSearch` | `search_web` |
| `WebFetch` | `read_url_content` |
| `Task` tool (dispatch subagent) | `browser_subagent` (limited — browser context only) |
| `CLAUDE.md` | `GEMINI.md` or `.agent/` config files |

## Subagent Support in Antigravity

Antigravity has `browser_subagent` which dispatches tasks in a browser context. This is **NOT** equivalent to Claude Code's `Task` tool which dispatches full coding subagents.

For skills that rely on subagent dispatch (`subagent-driven-development`, `dispatching-parallel-agents`):
- Fall back to **single-session execution** via `executing-plans`
- Use `task_boundary` tool for tracking progress
- Use artifact `task.md` for checklist tracking

## Antigravity-Specific Tools

These tools are available in Antigravity but have no Claude Code equivalent:

| Tool | Purpose |
|------|---------|
| `list_dir` | List files and subdirectories |
| `view_file_outline` | View file structure without reading full content |
| `view_code_item` | View specific functions/classes |
| `task_boundary` | Set/update task progress UI |
| `notify_user` | Communicate with user during task mode |
| `generate_image` | Generate images for UI mockups |
| `browser_subagent` | Dispatch browser-based subtasks |

## Skill Invocation in Antigravity

To invoke a skill in Antigravity:
1. Use `view_file` on `.agent/skills/<skill-name>/SKILL.md`
2. Follow the skill instructions exactly
3. Reference supporting files with `view_file` as needed
