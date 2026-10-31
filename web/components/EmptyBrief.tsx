import Link from "next/link";

export function EmptyBrief({ message, sourcePath }: { message: string; sourcePath: string }) {
  return (
    <main className="page">
      <section className="empty-state surface-marble">
        <h1>还没有可读的日报</h1>
        <p>{message}</p>
        <div className="command">
          cd pipeline<br />
          uv run horizon --hours 24
        </div>
        <p className="path">读取位置：{sourcePath}</p>
        <p>这里不会自动填入示例新闻。先配置 API 和每日任务，再读取一次真实运行结果。</p>
        <div className="actions">
          <Link href="/setup" className="key key--primary">打开设置</Link>
        </div>
      </section>
    </main>
  );
}
