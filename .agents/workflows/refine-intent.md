---
description: Bien mot cau chat ngan thanh ban dac ta ky thuat hoan chinh
---

## Khi nao dung
- User dua yeu cau mo ho (Context Gap >= 80%)
- Kernel Gatekeeper redirect ve day

## Pipeline 5 buoc

### Step 1: EXTRACT
Doc cau lenh user -> xac dinh: ACTION gi? tren DOI TUONG nao?

### Step 2: ENRICH
- Doc activeContext.md -> dang o phase nao?
- Doc REPO_GRAPH.md -> modules lien quan
- Doc systemPatterns.md -> patterns hien tai
- Tra CONTEXT_INDEX.md -> co context cu lien quan khong?
- Ket qua: danh sach 'da biet' vs 'chua biet'

### Step 3: INTERVIEW
Dat 3-5 cau hoi tu duy mo, KHONG hoi yes/no:
- Tech approach: 'Ban muon dung phuong phap nao cho {X}?'
- Scope: 'Feature nay bao gom nhung sub-features nao?'
- Constraints: 'Co rang buoc gi ve {security/performance/timeline}?'
- Integration: 'Phan nay can ket noi voi {module Y} the nao?'
- Edge cases: 'Neu {tinh huong Z} xay ra thi xu ly ra sao?'

### Step 4: SYNTHESIZE - Soan Master Prompt
Tong hop thanh Master Prompt voi format:
- NGU CANH: Du an, phase, stack, dang lam
- YEU CAU CHI TIET: Muc tieu + sub-tasks
- MODULES LIEN QUAN: Tu REPO_GRAPH
- RANG BUOC: Security, performance, conventions
- ACCEPTANCE CRITERIA: Checklist cu the
- VERIFICATION: Cach test/verify ket qua

### Step 5: CONFIRM va GHIM
Gui Master Prompt cho user review.
User approve -> LUU Master Prompt vao .context/current/{task-name}.md
-> File nay se duoc doc lai trong suot qua trinh code de chong troi context.
User approve -> **Invoke brainstorming skill** (`.agent/skills/brainstorming/SKILL.md`) de chuyen sang design phase
User sua -> quay lai Step 4, cap nhat Master Prompt

## Superpowers Integration
> Khi xong Step 5, dung **brainstorming** skill de refine design thanh spec 
> → sau do **writing-plans** skill de tao implementation plan chi tiet.
