import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";

type ActiveView = "简报" | "网络" | "词云" | "设置" | null;

export function AppHeader({
  date,
  status,
  active = null,
  themeSwitch = false,
  bilingual = false,
}: {
  date?: string;
  status?: string;
  active?: ActiveView;
  themeSwitch?: boolean;
  bilingual?: boolean;
}) {
  return (
    <header className="topbar">
      <div className="topbar__inner">
        <Link href="/" className="brand">
          <span className="brand__name">织讯</span>
          <span className="brand__sub">SignalWeb</span>
        </Link>

        <nav className="nav" aria-label={bilingual ? "主要导航 / Main navigation" : "主要导航"}>
          <Link href="/" aria-current={active === "简报" ? "page" : undefined}>{bilingual ? "简报 / Brief" : "简报"}</Link>
          <Link href="/network" aria-current={active === "网络" ? "page" : undefined}>{bilingual ? "网络 / Network" : "网络"}</Link>
          <Link href="/wordcloud" aria-current={active === "词云" ? "page" : undefined}>{bilingual ? "词云 / Word cloud" : "词云"}</Link>
          <Link href="/setup" aria-current={active === "设置" ? "page" : undefined}>{bilingual ? "设置 / Settings" : "设置"}</Link>
        </nav>

        <div className="topbar__meta">
          <span>{date || "等待首次运行"}</span>
          <span className="topbar__status">{status || "未连接数据"}</span>
          {themeSwitch ? <ThemeToggle bilingual={bilingual} /> : null}
        </div>
      </div>
    </header>
  );
}
