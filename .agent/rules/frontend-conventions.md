---
paths:
  - "dashboard-ui/**/*.tsx"
  - "dashboard-ui/**/*.ts"
  - "dashboard-ui/**/*.css"
---
# Frontend Conventions — FAOS v6 Dashboard

## Tech Stack
- Next.js 15 + React 19 + TailwindCSS
- Recharts cho charts/graphs
- TypeScript strict mode

## Component Structure
- Max **500 dong/file**. Neu vuot -> tach component con
- 1 component = 1 file (default export)
- Hooks rieng file: `use{HookName}.ts`
- Types rieng file khi > 20 dong: `{module}.types.ts`

## Naming
- Components: PascalCase (`DashboardCard`, `CampaignTable`)
- Files: PascalCase cho components (`DashboardCard.tsx`)
- Hooks: camelCase bat dau `use` (`useCampaignData.ts`)
- CSS modules: camelCase (`styles.cardContainer`)

## State Management
- Server Components mac dinh (Next.js 15)
- `'use client'` CHI khi can interactivity
- Fetching: Server Actions hoac API routes, KHONG fetch trong useEffect

## Performance
- Dung `React.memo` cho expensive renders
- Images: dung `next/image` voi width/height
- Lazy load components khong critical voi `dynamic()`

## Accessibility
- Tat ca interactive elements phai co aria-label
- Color contrast ratio >= 4.5:1
- Keyboard navigation support
