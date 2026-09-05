/**
 * Lớp trình bày dùng chung cho mọi tab TALPHA — port ngôn ngữ báo cáo của AUUS1.
 * Tab chỉ lo lấy số; cách bày số nằm hết ở đây để 5 tab không trôi mỗi nơi một kiểu.
 */
export { ReportHero, default as ReportHeroDefault } from "./report-hero";
export type { HeroProgress } from "./report-hero";

export { KpiTile, KpiRow } from "./kpi-tile";
export type { KpiTone } from "./kpi-tile";

export { ResultCard } from "./result-card";
export type { BarSegment, SubStat } from "./result-card";

export { WaterfallList } from "./waterfall";
export type { WaterfallRow } from "./waterfall";

export { BarStrip } from "./bar-strip";
export type { BarItem } from "./bar-strip";

export { ReportTable, DASH } from "./report-table";
export type { Column } from "./report-table";

export { FootNotes } from "./foot-notes";

export {
    lightForAdsPct, lightForHigher, LightDot, LightEmoji, LightLegend,
    ADS_PCT_GOOD, ADS_PCT_WARN,
} from "./status-light";
export type { Light } from "./status-light";
