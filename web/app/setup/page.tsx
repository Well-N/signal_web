"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AppHeader } from "../../components/AppHeader";

type Settings = {
  endpoint: string;
  model: string;
  time: string;
  language: string;
  schedule_enabled: boolean;
  headers?: Record<string, string>;
  notify_feishu?: boolean;
  notify_wecom?: boolean;
  notify_enabled?: boolean;
  report_dir?: string;
  pdf_style?: string;
  updated_at?: string;
};

type RunStatus = {
  ok: boolean;
  started_at?: string;
  finished_at?: string;
  stage?: string;
  error?: string;
  date?: string;
  story_count?: number;
  pdf_path?: string;
  pdf_style?: string;
  notifications?: Record<string, { ok: boolean; error?: string }>;
};

type RunnerStatus = {
  settings_path: string;
  settings: Settings | null;
  settings_error?: string;
  has_api_key: boolean;
  has_extra_headers?: boolean;
  has_feishu_webhook?: boolean;
  has_wecom_webhook?: boolean;
  run_active?: boolean;
  default_report_dir?: string;
  pdf_styles?: { id: string; name: string; description: string }[];
  last_run: RunStatus | null;
  latest: {
    date?: string;
    is_sample?: boolean;
    stats?: { story_count?: number; source_count?: number };
    generated_at?: string;
  } | null;
};

type RunProgress = {
  state: string;
  stage?: string;
  percent?: number;
  started_at?: string;
  error?: string;
};

type StatusEnvelope = {
  ok: boolean;
  status?: RunnerStatus;
  error?: string;
};

type SourceConfig = {
  hackernews: { enabled: boolean; min_score: number; fetch_top_stories: number };
  google_news: { enabled: boolean; query: string; max_results: number; language: string; country: string };
  rss: { name: string; url: string; enabled: boolean; profile: string }[];
  section_keywords: Record<string, string>;
  section_thresholds: Record<string, number | null>;
};

const TOPICS = [
  { id: "ai-news", label: "AI 资讯" },
  { id: "finance-news", label: "财经" },
  { id: "world-news", label: "世界大事" },
  { id: "solopreneur", label: "创业" },
  { id: "cross-border", label: "跨境电商" },
];

const SECTION_KEYWORD_OPTIONS = [
  { id: "ai-news", label: "AI 资讯", placeholder: "AI OR OpenAI OR Anthropic OR LLM" },
  { id: "finance-news", label: "财经", placeholder: "stock market OR Federal Reserve OR earnings" },
  { id: "world-news", label: "世界大事", placeholder: "world news OR geopolitics OR conflict" },
  { id: "solopreneur", label: "创业", placeholder: "solopreneur OR indie hacker OR one-person business" },
  { id: "cross-border", label: "跨境电商", placeholder: "cross-border ecommerce OR Amazon seller" },
];

function isGoogleNewsSearchFeed(value: string) {
  try {
    const url = new URL(value);
    return url.hostname === "news.google.com" && url.pathname === "/rss/search";
  } catch {
    return false;
  }
}

const PDF_STYLE_OPTIONS = [
  { id: "grid", name: "网格档案", description: "白纸、群青与瑞士红，像一张现代主义展册。" },
  { id: "darkroom", name: "暗房", description: "暖黑纸、纤维白与一盏琥珀安全灯，安静而克制。" },
  { id: "atelier", name: "手作工坊", description: "亚麻纸、深褐字与石板蓝，像一本安静的造物目录。" },
  { id: "riso", name: "孔版印刷", description: "蓝墨、荧光粉与错位套印，像一份小出版社的日报。" },
];

const RUN_STAGE_LABELS: Record<string, string> = {
  starting: "准备运行",
  fetching: "抓取来源",
  analyzing: "AI 分析",
  filtering: "筛选与去重",
  enriching: "补充背景",
  exporting: "生成日报",
  pdf: "生成 PDF",
  finished: "完成",
  failed: "运行失败",
};

const DELIVERY_CHANNEL_LABELS: Record<string, string> = {
  feishu: "飞书",
  wecom: "企业微信",
};

function formatRunTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

type Provider = {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  headers?: Record<string, string>;
};

const PROVIDERS: Provider[] = [
  { id: "", name: "中转站或自定义地址", endpoint: "", model: "" },
  {
    id: "opencode",
    name: "OpenCode Go",
    endpoint: "https://opencode.ai/inference/go/openai/v1",
    model: "deepseek-v4.1-flash",
    headers: { "x-opencode-session": "signalweb-local" },
  },
  { id: "openai", name: "OpenAI", endpoint: "https://api.openai.com/v1", model: "gpt-6.1-sol" },
  { id: "deepseek", name: "DeepSeek", endpoint: "https://api.deepseek.com/v1", model: "deepseek-flash" },
  { id: "moonshot", name: "月之暗面 Kimi", endpoint: "https://api.moonshot.ai/v1", model: "kimi-k3.1-pro" },
  { id: "zhipu", name: "智谱 GLM", endpoint: "https://open.bigmodel.cn/api/paas/v4", model: "glm-5.3" },
  { id: "dashscope", name: "阿里云百炼", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen3.8-max" },
  { id: "siliconflow", name: "硅基流动", endpoint: "https://api.siliconflow.cn/v1", model: "deepseek-ai/DeepSeek-V4.1-Flash" },
];

function providerForEndpoint(value: string) {
  const clean = value.trim().replace(/\/+$/, "");
  return PROVIDERS.find((provider) => provider.endpoint && provider.endpoint === clean)?.id ?? "";
}

function parseHeaders(value: string): Record<string, string> {
  const text = value.trim();
  if (!text) return {};
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("额外请求头必须是 JSON 对象");
  }
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).map(([name, headerValue]) => [name, String(headerValue)]),
  );
}

export default function SetupPage() {
  const [endpoint, setEndpoint] = useState("");
  const [provider, setProvider] = useState("");
  const [headers, setHeaders] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [time, setTime] = useState("08:00");
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [runner, setRunner] = useState<RunnerStatus | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sources, setSources] = useState<SourceConfig | null>(null);
  const [sourceSaving, setSourceSaving] = useState(false);
  const [sourceMessage, setSourceMessage] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [polling, setPolling] = useState(false);
  const [notifyFeishu, setNotifyFeishu] = useState(false);
  const [notifyWecom, setNotifyWecom] = useState(false);
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [feishuWebhook, setFeishuWebhook] = useState("");
  const [wecomWebhook, setWecomWebhook] = useState("");
  const [reportDir, setReportDir] = useState("");
  const [pdfStyle, setPdfStyle] = useState("grid");
  const [deliverySaving, setDeliverySaving] = useState(false);
  const [deliveryMessage, setDeliveryMessage] = useState("");
  const [deliveryError, setDeliveryError] = useState("");
  const [folderPicking, setFolderPicking] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [runProgress, setRunProgress] = useState<RunProgress | null>(null);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [runStarting, setRunStarting] = useState(false);
  const [startupEnabled, setStartupEnabled] = useState(false);
  const [startupAvailable, setStartupAvailable] = useState(false);
  const [startupBusy, setStartupBusy] = useState(false);
  const deliveryToggleBusy = useRef(false);
  const headersTouched = useRef(false);

  async function loadStatus() {
    try {
      const response = await fetch("/api/setup", { cache: "no-store" });
      const payload = (await response.json()) as StatusEnvelope;
      if (payload.status) {
        setRunner(payload.status);
        const statusRun = payload.status.last_run;
        if (statusRun?.started_at && !statusRun.finished_at && !statusRun.error) {
          const statusStartedAt = Date.parse(statusRun.started_at);
          setRunStartedAt((current) =>
            current ?? (Number.isFinite(statusStartedAt) ? statusStartedAt : null),
          );
          setPolling(true);
        } else if (payload.status.run_active) {
          setPolling(true);
        } else if (!payload.status.run_active) {
          setPolling(false);
          setRunStartedAt(null);
          setRunProgress((current) =>
            current?.state === "running"
              ? { ...current, state: "failed", stage: "failed", percent: 100, error: "运行未能启动或已意外中断" }
              : current,
          );
        }
        if (payload.status.settings) {
          setEndpoint(payload.status.settings.endpoint);
          setModel(payload.status.settings.model);
          setTime(payload.status.settings.time);
          if (!deliveryToggleBusy.current) {
            setScheduleEnabled(payload.status.settings.schedule_enabled);
            setNotifyEnabled(Boolean(payload.status.settings.notify_enabled));
          }
          if (!headersTouched.current) setHeaders("");
          setProvider(providerForEndpoint(payload.status.settings.endpoint));
          setNotifyFeishu(Boolean(payload.status.settings.notify_feishu));
          setNotifyWecom(Boolean(payload.status.settings.notify_wecom));
          setReportDir(payload.status.settings.report_dir || payload.status.default_report_dir || "");
          setPdfStyle(payload.status.settings.pdf_style || "grid");
        }
      } else if (payload.error) {
        setError(payload.error);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  useEffect(() => {
    // Initial status hydration reads a local runner status endpoint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStatus();
    void (async () => {
      try {
        const response = await fetch("/api/sources", { cache: "no-store" });
        const payload = (await response.json()) as {
          ok?: boolean;
          sources?: SourceConfig;
          error?: string;
        };
        if (payload.ok && payload.sources) setSources(payload.sources);
        else if (payload.error) setSourceError(payload.error);
      } catch (caught) {
        setSourceError(caught instanceof Error ? caught.message : String(caught));
      }
    })();
  }, []);

  useEffect(() => {
    const bridge = (
      window as unknown as {
        signalweb?: {
          getStartup?: () => Promise<boolean>;
        };
      }
    ).signalweb;
    if (!bridge?.getStartup) return;
    bridge
      .getStartup()
      .then((enabled) => {
        setStartupAvailable(true);
        setStartupEnabled(Boolean(enabled));
      })
      .catch(() => setStartupAvailable(false));
  }, []);

  async function toggleStartup(enabled: boolean) {
    const bridge = (
      window as unknown as {
        signalweb?: {
          setStartup?: (value: boolean) => Promise<boolean>;
        };
      }
    ).signalweb;
    if (!bridge?.setStartup) {
      setDeliveryError("开机自启动只能在桌面应用里设置。");
      return;
    }
    setStartupBusy(true);
    setDeliveryError("");
    setStartupEnabled(enabled);
    try {
      const result = await bridge.setStartup(enabled);
      if (Boolean(result) !== enabled) throw new Error("开机自启动设置没有生效，请检查系统启动项。");
      setDeliveryMessage(result ? "已开启开机自启动。" : "已关闭开机自启动。");
    } catch (caught) {
      setStartupEnabled(!enabled);
      setDeliveryError(caught instanceof Error ? caught.message : "开机自启动设置失败");
    } finally {
      setStartupBusy(false);
    }
  }

  async function toggleDeliveryOption(option: "schedule_enabled" | "notify_enabled", enabled: boolean) {
    deliveryToggleBusy.current = true;
    setDeliverySaving(true);
    setDeliveryError("");
    setDeliveryMessage("");
    if (option === "schedule_enabled") setScheduleEnabled(enabled);
    else setNotifyEnabled(enabled);
    try {
      const response = await fetch("/api/setup/delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [option]: enabled }),
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok || payload.ok !== true) {
        throw new Error(String(payload.error || "设置更新失败"));
      }
      setDeliveryMessage(
        option === "schedule_enabled"
          ? enabled ? "已开启每日自动运行。" : "已取消每日自动运行。"
          : enabled ? "已开启每日推送。" : "已取消每日推送。",
      );
    } catch (caught) {
      if (option === "schedule_enabled") setScheduleEnabled(!enabled);
      else setNotifyEnabled(!enabled);
      setDeliveryError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      deliveryToggleBusy.current = false;
      setDeliverySaving(false);
    }
  }

  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => {
      void loadStatus();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [polling]);

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    const readProgress = async () => {
      try {
        const response = await fetch("/api/crawl/events", { cache: "no-store" });
        const payload = (await response.json()) as RunProgress;
        if (cancelled) return;
        const eventStarted = payload.started_at ? Date.parse(payload.started_at) : 0;
        const current = !runStartedAt || eventStarted >= runStartedAt - 1_000;
        if (!current) return;
        setRunProgress(payload);
        if (payload.state === "finished" || payload.state === "failed") {
          setPolling(false);
          setRunStartedAt(null);
          if (payload.state === "failed") setError(payload.error || "后台运行失败");
          await loadStatus();
        }
      } catch {
        // The event file is replaced at run start; the next tick retries.
      }
    };
    void readProgress();
    const timer = window.setInterval(() => void readProgress(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [polling, runStartedAt]);

  async function save() {
    setSaving(true);
    setError("");
    setMessage("");
    let headerMap: Record<string, string> | undefined;
    try {
      headerMap = headers.trim() ? parseHeaders(headers) : undefined;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "额外请求头格式不对");
      setSaving(false);
      return;
    }
    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint,
          model,
          api_key: apiKey,
          time,
          language: "zh",
          schedule_enabled: scheduleEnabled,
          ...(headerMap === undefined ? {} : { headers: headerMap }),
        }),
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok || payload.ok !== true) {
        throw new Error(String(payload.error || "配置失败"));
      }
      setApiKey("");
      setHeaders("");
      headersTouched.current = false;
      if (payload.run_started === false) {
        setError("配置已保存，但首次抓取未能启动：" + String(payload.run_error || "未知原因"));
      } else {
        setMessage("配置已保存，每日任务已注册，首次抓取正在后台开始。");
        setRunStartedAt(Date.now());
        setRunProgress({ state: "running", stage: "starting", percent: 2 });
        setPolling(true);
      }
      await loadStatus();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    if (runStarting || polling) return;
    setError("");
    setMessage("");
    setRunStarting(true);
    try {
      const response = await fetch("/api/setup/run", { method: "POST" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "启动失败");
      setMessage("已启动一次后台抓取，状态会自动刷新。");
      setRunStartedAt(Date.now());
      setRunProgress({ state: "running", stage: "starting", percent: 2 });
      setPolling(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "启动失败");
      setPolling(false);
      setRunProgress({ state: "failed", stage: "failed", percent: 100 });
    } finally {
      setRunStarting(false);
    }
  }

  async function testConnection() {
    if (!endpoint.trim()) {
      setError("先填 API Base URL，或者在上面的服务商里选一个。");
      setMessage("");
      return;
    }
    if (!model.trim()) {
      setError("模型名不能为空。");
      setMessage("");
      return;
    }
    if (!apiKey.trim() && !runner?.has_api_key) {
      setError("先填 API Key 再测试。");
      setMessage("");
      return;
    }
    let headerMap: Record<string, string> | undefined;
    try {
      headerMap = headers.trim() ? parseHeaders(headers) : undefined;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "额外请求头格式不对");
      setMessage("");
      return;
    }
    setTesting(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/setup/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint,
          model,
          api_key: apiKey,
          ...(headerMap === undefined ? {} : { headers: headerMap }),
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        endpoint?: string;
        model?: string;
      };
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.error || "连接测试失败");
      }
      setMessage("连接正常，" + (payload.model || model) + " 可以调用。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setTesting(false);
    }
  }

  async function saveSources(scope: "all" | "sections" = "all") {
    if (!sources) return;
    setSourceSaving(true);
    setSourceError("");
    setSourceMessage("");
    try {
      const response = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sources),
      });
      const payload = (await response.json()) as { ok?: boolean; sources?: SourceConfig; error?: string };
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.error || "保存来源失败");
      }
      if (payload.sources) setSources(payload.sources);
      setSourceMessage(
        scope === "sections"
          ? "板块设置已保存，下次运行按新关键词和评分阈值筛选。"
          : "来源设置已保存，下次运行按新设置抓取。",
      );
    } catch (caught) {
      setSourceError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSourceSaving(false);
    }
  }

  async function chooseFolder() {
    const bridge = (
      window as unknown as {
        signalweb?: { selectFolder: () => Promise<string | null> };
      }
    ).signalweb;
    if (!bridge?.selectFolder) {
      setDeliveryError("当前是浏览器预览，请直接在输入框填写绝对路径。");
      return;
    }
    setFolderPicking(true);
    setDeliveryError("");
    try {
      const picked = await bridge.selectFolder();
      if (picked) setReportDir(picked);
    } catch (caught) {
      setDeliveryError(caught instanceof Error ? caught.message : "无法打开文件夹选择器");
    } finally {
      setFolderPicking(false);
    }
  }

  async function saveDelivery() {
    if (notifyEnabled && notifyFeishu && !feishuWebhook.trim() && !runner?.has_feishu_webhook) {
      setDeliveryError("启用飞书投递前，需要填写飞书机器人 Webhook。");
      return;
    }
    if (notifyEnabled && notifyWecom && !wecomWebhook.trim() && !runner?.has_wecom_webhook) {
      setDeliveryError("启用企业微信投递前，需要填写企业微信机器人 Webhook。");
      return;
    }
    setDeliverySaving(true);
    setDeliveryError("");
    setDeliveryMessage("");
    try {
      const response = await fetch("/api/setup/delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          time,
          schedule_enabled: scheduleEnabled,
          notify_enabled: notifyEnabled,
          notify_feishu: notifyFeishu,
          notify_wecom: notifyWecom,
          feishu_webhook: feishuWebhook.trim(),
          wecom_webhook: wecomWebhook.trim(),
          report_dir: reportDir.trim(),
          pdf_style: pdfStyle,
        }),
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok || payload.ok !== true) {
        throw new Error(String(payload.error || "投递设置保存失败"));
      }
      setFeishuWebhook("");
      setWecomWebhook("");
      setDeliveryMessage("投递设置已保存，定时任务已按新时间更新。");
      await loadStatus();
    } catch (caught) {
      setDeliveryError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setDeliverySaving(false);
    }
  }

  async function publishToday() {
    setPublishing(true);
    setDeliveryError("");
    setDeliveryMessage("");
    try {
      const response = await fetch("/api/setup/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_dir: reportDir.trim(), pdf_style: pdfStyle }),
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok || payload.ok !== true) {
        throw new Error(String(payload.error || "PDF 导出失败"));
      }
      setDeliveryMessage("今日 PDF 已导出：" + String(payload.pdf_path || ""));
      await loadStatus();
    } catch (caught) {
      setDeliveryError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPublishing(false);
    }
  }

  function updateHn(patch: Partial<SourceConfig["hackernews"]>) {
    setSources((prev) => (prev ? { ...prev, hackernews: { ...prev.hackernews, ...patch } } : prev));
  }

  function updateGn(patch: Partial<SourceConfig["google_news"]>) {
    setSources((prev) => (prev ? { ...prev, google_news: { ...prev.google_news, ...patch } } : prev));
  }

  function updateSectionKeyword(profile: string, value: string) {
    setSources((prev) =>
      prev
        ? {
            ...prev,
            google_news:
              profile === "ai-news"
                ? { ...prev.google_news, query: value }
                : prev.google_news,
            section_keywords: { ...prev.section_keywords, [profile]: value },
          }
        : prev,
    );
  }

  function updateSectionThreshold(profile: string, value: string) {
    setSources((prev) =>
      prev
        ? {
            ...prev,
            section_thresholds: {
              ...prev.section_thresholds,
              [profile]: value === "" ? null : Number(value),
            },
          }
        : prev,
    );
  }

  function updateFeed(index: number, patch: Partial<SourceConfig["rss"][number]>) {
    setSources((prev) =>
      prev
        ? { ...prev, rss: prev.rss.map((feed, i) => (i === index ? { ...feed, ...patch } : feed)) }
        : prev,
    );
  }

  function removeFeed(index: number) {
    setSources((prev) => (prev ? { ...prev, rss: prev.rss.filter((_, i) => i !== index) } : prev));
  }

  function addFeed() {
    setSources((prev) =>
      prev ? { ...prev, rss: [...prev.rss, { name: "", url: "https://", enabled: true, profile: "ai-news" }] } : prev,
    );
  }

  const configured = Boolean(runner?.settings);
  const lastRun = runner?.last_run;
  const pdfStyleOptions = runner?.pdf_styles?.length ? runner.pdf_styles : PDF_STYLE_OPTIONS;
  const selectedPdfStyle = pdfStyleOptions.find((style) => style.id === pdfStyle) || pdfStyleOptions[0];
  const progressPercent = Math.min(100, Math.max(0, runProgress?.percent ?? 2));
  const progressStage = RUN_STAGE_LABELS[runProgress?.stage ?? "starting"] || "正在运行";
  const lastRunRunning = Boolean(lastRun && !lastRun.finished_at && !lastRun.error);

  return (
    <div className="app-shell app-shell--warm">
      <AppHeader active="设置" themeSwitch />
      <main className="page">
        <header className="page-head">
          <div className="page-head__copy">
            <h1>让织讯自己工作</h1>
            <p>填写一次 API 信息，织讯会把密钥存进系统凭据库，注册每日任务，并立即抓取第一批内容。</p>
          </div>
          <Link href="/" className="text-link">返回看板</Link>
        </header>

        {polling || runProgress?.state === "running" ? (
          <section className="run-progress" aria-live="polite" aria-label="抓取进度">
            <div className="run-progress__head">
              <span>{progressStage}</span>
              <strong>{Math.round(progressPercent)}%</strong>
            </div>
            <div className="run-progress__track">
              <div
                className="run-progress__bar"
                style={{ transform: `scaleX(${progressPercent / 100})` }}
              />
            </div>
            <p>后台抓取和 AI 分析正在运行，完成后会自动刷新。</p>
          </section>
        ) : null}

        <div className="setup-grid">
          <section className="setup-sheet surface-marble">
            <div className="form-field">
              <label htmlFor="provider">服务商</label>
              <select
                id="provider"
                value={provider}
                onChange={(event) => {
                  const next = event.target.value;
                  setProvider(next);
                  const preset = PROVIDERS.find((item) => item.id === next);
                  if (preset?.endpoint) {
                    setEndpoint(preset.endpoint);
                    setModel(preset.model);
                    headersTouched.current = true;
                    setHeaders(JSON.stringify(preset.headers ?? {}, null, 2));
                  }
                }}
                className="field"
              >
                {PROVIDERS.map((item) => (
                  <option key={item.id || "custom"} value={item.id}>{item.name}</option>
                ))}
              </select>
              <span className="field-hint">
                选一个服务商会自动填入地址和对应的默认模型。用中转站时选第一项，把中转站给的 Base URL 填到下面，通常以 /v1 结尾。
              </span>
            </div>
            <div className="form-field">
              <label htmlFor="endpoint">API Base URL</label>
              <input
                id="endpoint"
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                placeholder="https://api.openai.com/v1"
                autoComplete="url"
                className="field"
              />
              <span className="field-hint">需要以 https:// 开头；只支持兼容 /chat/completions 的接口。</span>
            </div>
            <div className="form-field">
              <label htmlFor="model">模型名</label>
              <input
                id="model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="gpt-6.1-sol"
                autoComplete="off"
                className="field"
              />
            </div>
            <div className="form-field">
              <label htmlFor="api-key">API Key</label>
              <input
                id="api-key"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                type="password"
                autoComplete="off"
                placeholder={runner?.has_api_key ? "已保存，留空则不修改" : "输入 API Key"}
                className="field"
              />
              <span className="field-hint">
                Key 只写入 Windows Credential Manager 或 macOS Keychain，不进入浏览器存储和 JSON 配置文件。
              </span>
            </div>
            <div className="form-field">
              <label htmlFor="extra-headers">额外请求头</label>
              <textarea
                id="extra-headers"
                value={headers}
                onChange={(event) => {
                  headersTouched.current = true;
                  setHeaders(event.target.value);
                }}
                rows={3}
                spellCheck={false}
                className="field field--area"
                placeholder='{"x-opencode-session": "signalweb-local"}'
              />
              <span className="field-hint">
                {runner?.has_extra_headers && !headers
                  ? "已保存到系统凭据库；留空保持，输入 {} 可清除。"
                  : "可选。值会保存在系统凭据库；输入 {} 可清除。"}
              </span>
            </div>
            <div className="actions">
              <button onClick={save} disabled={saving} className="key key--primary" type="button">
                {saving ? "保存中…" : "保存并开始运行"}
              </button>
              <button onClick={testConnection} disabled={testing} className="key" type="button">
                {testing ? "测试中…" : "测试连接"}
              </button>
              {configured ? (
                <button
                  onClick={runNow}
                  disabled={runStarting || polling || runner?.run_active || runProgress?.state === "running"}
                  className="key"
                  type="button"
                >
                  立即运行一次
                </button>
              ) : null}
            </div>
            <p className={error ? "message message--error" : "message message--ok"} aria-live="polite">
              {error || message}
            </p>
          </section>

          <aside className="setup-side">
            <section className="setup-status">
              <h2>配置状态</h2>
              <p>{configured ? "已完成初始化" : "等待初始化"}</p>
              <p>{runner?.has_api_key ? "系统凭据库中有 API Key" : "尚未保存 API Key"}</p>
              <p>{runner?.has_extra_headers ? "系统凭据库中有额外请求头" : "未配置额外请求头"}</p>
            </section>
            <section className="setup-status">
              <h2>投递与归档</h2>
              <p>PDF：{selectedPdfStyle?.name || "网格档案"}</p>
              <p>每日运行：{runner?.settings?.schedule_enabled ? "开" : "关"}</p>
              <p>每日推送：{notifyEnabled ? "开" : "关"}</p>
              <p>开机自启动：{startupAvailable ? (startupEnabled ? "开" : "关") : "仅桌面版"}</p>
              <p>飞书：{runner?.has_feishu_webhook ? "Webhook 已保存" : "未配置"}</p>
              <p>企业微信：{runner?.has_wecom_webhook ? "Webhook 已保存" : "未配置"}</p>
              {runner?.settings?.report_dir ? (
                <p className="setup-path">{runner.settings.report_dir}</p>
              ) : null}
            </section>
            <section className="setup-status">
              <h2>最近一次运行</h2>
              {lastRun ? (
                <>
                  <p className={lastRunRunning || lastRun.ok ? "message--ok" : "message--error"}>
                    {lastRunRunning ? "正在运行" : lastRun.ok ? "运行成功" : "运行失败"}
                  </p>
                  {lastRunRunning && lastRun.started_at ? (
                    <p>开始于 {formatRunTime(lastRun.started_at)}</p>
                  ) : null}
                  {lastRun.finished_at ? <p>{formatRunTime(lastRun.finished_at)}</p> : null}
                  {!lastRunRunning && lastRun.story_count !== undefined ? <p>{lastRun.story_count} 个故事</p> : null}
                  {!lastRunRunning && lastRun.pdf_path ? <p className="setup-path">{lastRun.pdf_path}</p> : null}
                  {!lastRunRunning && lastRun.notifications
                    ? Object.entries(lastRun.notifications).map(([channel, result]) => (
                        <p
                          className={result.ok ? "message--ok" : "message--error"}
                          key={channel}
                        >
                          {DELIVERY_CHANNEL_LABELS[channel] || channel}：
                          {result.ok ? "已发送" : result.error || "发送失败"}
                        </p>
                      ))
                    : null}
                  {!lastRunRunning && lastRun.error ? (
                    <p className="message--error">{lastRun.error}</p>
                  ) : null}
                </>
              ) : (
                <p>还没有运行记录。</p>
              )}
            </section>
            <section className="setup-status">
              <h2>工作方式</h2>
              <p>保存 Key，注册系统每日任务，后台运行 Horizon，生成 latest.json，再由看板读取。</p>
            </section>
          </aside>
        </div>

        <section className="setup-sheet setup-delivery surface-marble" aria-labelledby="delivery-heading">
          <div className="setup-sources__head">
            <h2 id="delivery-heading">日报投递</h2>
            <span>时间会立即更新任务，通知与 PDF 从下一次运行生效</span>
          </div>

          <div className="delivery-schedule">
            <div className="form-field">
              <label htmlFor="daily-time">每日运行时间</label>
              <input
                id="daily-time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                type="time"
                className="field"
              />
            </div>
            <label className="checkbox-row" htmlFor="schedule-enabled">
              <input
                id="schedule-enabled"
                checked={scheduleEnabled}
                disabled={deliverySaving}
                onChange={(event) => void toggleDeliveryOption("schedule_enabled", event.target.checked)}
                type="checkbox"
              />
              每日自动运行
            </label>
            <label className="checkbox-row" htmlFor="startup-enabled">
              <input
                id="startup-enabled"
                checked={startupEnabled}
                disabled={!startupAvailable || startupBusy}
                onChange={(event) => void toggleStartup(event.target.checked)}
                type="checkbox"
              />
              开机自启动
            </label>
            <label className="checkbox-row" htmlFor="notify-enabled">
              <input
                id="notify-enabled"
                checked={notifyEnabled}
                disabled={deliverySaving}
                onChange={(event) => void toggleDeliveryOption("notify_enabled", event.target.checked)}
                type="checkbox"
              />
              每日推送
            </label>
          </div>

          <div className="delivery-grid">
            <div className="delivery-pane">
              <div className="delivery-pane__head">
                <h3>消息通知</h3>
                <span>可同时启用飞书和企业微信</span>
              </div>

              <div className="delivery-channel">
                <label className="checkbox-row" htmlFor="notify-feishu">
                  <input
                    id="notify-feishu"
                    type="checkbox"
                    checked={notifyFeishu}
                    onChange={(event) => setNotifyFeishu(event.target.checked)}
                  />
                  飞书机器人
                </label>
                <input
                  id="feishu-webhook"
                  className="field"
                  type="url"
                  value={feishuWebhook}
                  onChange={(event) => setFeishuWebhook(event.target.value)}
                  placeholder={
                    runner?.has_feishu_webhook
                      ? "已保存，留空不修改"
                      : "https://open.feishu.cn/open-apis/bot/v2/hook/..."
                  }
                  autoComplete="off"
                />
                <span className="field-hint">
                  接受飞书自定义机器人 Webhook；立即运行和每日运行都会在 PDF 生成后发送摘要。
                  地址保存在系统凭据库，不写入 JSON。
                </span>
              </div>

              <div className="delivery-channel">
                <label className="checkbox-row" htmlFor="notify-wecom">
                  <input
                    id="notify-wecom"
                    type="checkbox"
                    checked={notifyWecom}
                    onChange={(event) => setNotifyWecom(event.target.checked)}
                  />
                  企业微信机器人
                </label>
                <input
                  id="wecom-webhook"
                  className="field"
                  type="url"
                  value={wecomWebhook}
                  onChange={(event) => setWecomWebhook(event.target.value)}
                  placeholder={
                    runner?.has_wecom_webhook
                      ? "已保存，留空不修改"
                      : "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
                  }
                  autoComplete="off"
                />
                <span className="field-hint">
                  企业微信机器人会收到同一条信号摘要；两个渠道可以同时开启。
                </span>
              </div>
            </div>

            <div className="delivery-pane">
              <div className="delivery-pane__head">
                <h3>PDF 归档</h3>
                <span>每天生成一份可打印日报</span>
              </div>

              <div className="form-field">
                <label htmlFor="report-dir">保存位置</label>
                <div className="path-row">
                  <input
                    id="report-dir"
                    className="field"
                    value={reportDir}
                    onChange={(event) => setReportDir(event.target.value)}
                    placeholder={runner?.default_report_dir || "选择或输入绝对路径"}
                  />
                  <button
                    type="button"
                    className="key key--small"
                    onClick={chooseFolder}
                    disabled={folderPicking}
                  >
                    {folderPicking ? "选择中…" : "选择文件夹"}
                  </button>
                </div>
                <span className="field-hint">
                  默认放在文档目录下的 SignalWeb Reports；文件名为 signalweb-日期-风格.pdf。
                </span>
              </div>

              <fieldset className="pdf-style-fieldset">
                <legend>PDF 风格</legend>
                <div className="pdf-style-grid">
                  {pdfStyleOptions.map((style) => (
                    <label
                      key={style.id}
                      className={`pdf-style-option${pdfStyle === style.id ? " is-selected" : ""}`}
                    >
                      <input
                        className="pdf-style-radio"
                        type="radio"
                        name="pdf-style"
                        value={style.id}
                        checked={pdfStyle === style.id}
                        onChange={() => setPdfStyle(style.id)}
                      />
                      <span
                        className={`pdf-style-preview pdf-style-preview--${style.id}`}
                        aria-hidden="true"
                      >
                        <span className="pdf-style-preview__mark">PDF</span>
                        <span className="pdf-style-preview__rule" />
                        <span className="pdf-style-preview__sample">AI 信号日报</span>
                      </span>
                      <span className="pdf-style-name">{style.name}</span>
                      <span className="pdf-style-desc">{style.description}</span>
                    </label>
                  ))}
                </div>
                <span className="field-hint">
                  当前选择：{selectedPdfStyle?.name || "网格档案"}。风格只影响 PDF，不改变看板。
                </span>
              </fieldset>
            </div>
          </div>

          <div className="actions">
            <button
              type="button"
              className="key key--primary"
              onClick={saveDelivery}
              disabled={deliverySaving}
            >
              {deliverySaving ? "保存中…" : "保存投递设置"}
            </button>
            <button
              type="button"
              className="key"
              onClick={publishToday}
              disabled={publishing}
            >
              {publishing ? "导出中…" : "立即导出今日 PDF"}
            </button>
          </div>
          <p
            className={deliveryError ? "message message--error" : "message message--ok"}
            aria-live="polite"
          >
            {deliveryError || deliveryMessage}
          </p>
        </section>

        <section className="setup-sheet setup-sources surface-marble" aria-labelledby="sources-heading">
          <div className="setup-sources__head">
            <h2 id="sources-heading">抓取来源</h2>
            <span>改动从下一次运行开始生效</span>
          </div>

          {sources ? (
            <>
              <div className="source-block source-block--keywords">
                <div className="source-block__head">
                  <h3>板块设置</h3>
                  <span>关键词与 AI 入选评分</span>
                </div>
                <div className="section-keyword-grid">
                  {SECTION_KEYWORD_OPTIONS.map((topic) => {
                    const keyword = sources.section_keywords?.[topic.id] || "";
                    return (
                      <div className="form-field" key={topic.id}>
                        <label htmlFor={`keyword-${topic.id}`}>
                          {topic.label}
                          {!keyword.trim() ? <span className="keyword-empty-label"> · 未设置</span> : null}
                        </label>
                        <textarea
                          id={`keyword-${topic.id}`}
                          className={keyword.trim() ? "field" : "field field--empty-keyword"}
                          value={keyword}
                          rows={1}
                          placeholder={`点击输入${topic.label}关键词`}
                          aria-label={`${topic.label}关键词`}
                          onChange={(event) => updateSectionKeyword(topic.id, event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void saveSources("sections");
                            }
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
                <span className="field-hint">
                  用 OR 连接同义词，也可使用引号、site: 或 when:；进入编辑框会自动放大，按 Enter 保存。
                  留空则不为此板块发起 Google News 搜索。
                </span>
                <div className="section-threshold-block">
                  <div className="source-block__head">
                    <h4>入选评分阈值</h4>
                    <span>满分 10 分</span>
                  </div>
                  <div className="section-threshold-grid">
                    {SECTION_KEYWORD_OPTIONS.map((topic) => (
                      <div className="form-field" key={topic.id}>
                        <label htmlFor={`threshold-${topic.id}`}>{topic.label}</label>
                        <input
                          id={`threshold-${topic.id}`}
                          className="field"
                          type="number"
                          min={0}
                          max={10}
                          step={0.5}
                          value={sources.section_thresholds?.[topic.id] ?? ""}
                          placeholder="不限制"
                          onChange={(event) => updateSectionThreshold(topic.id, event.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                  <span className="field-hint">
                    AI 评分低于阈值的新闻不会进入日报；留空表示不限制。阈值从下一次运行开始生效。
                  </span>
                </div>
                <div className="keyword-save-row">
                  <button
                    type="button"
                    className="key key--primary"
                    onClick={() => void saveSources("sections")}
                    disabled={sourceSaving}
                  >
                    {sourceSaving ? "保存中…" : "保存板块设置"}
                  </button>
                  <span>保存后会更新板块关键词和新闻入选阈值。</span>
                </div>
                <p
                  className={sourceError ? "message message--error" : "message message--ok"}
                  aria-live="polite"
                >
                  {sourceError || sourceMessage}
                </p>
              </div>

              <div className="source-block">
                <label className="checkbox-row" htmlFor="hn-enabled">
                  <input
                    id="hn-enabled"
                    type="checkbox"
                    checked={sources.hackernews.enabled}
                    onChange={(event) => updateHn({ enabled: event.target.checked })}
                  />
                  Hacker News
                </label>
                <div className="source-block__fields">
                  <div className="form-field">
                    <label htmlFor="hn-score">最低热度</label>
                    <input
                      id="hn-score"
                      type="number"
                      min={0}
                      className="field"
                      value={sources.hackernews.min_score}
                      onChange={(event) => updateHn({ min_score: Number(event.target.value) })}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="hn-count">取前几条</label>
                    <input
                      id="hn-count"
                      type="number"
                      min={1}
                      max={500}
                      className="field"
                      value={sources.hackernews.fetch_top_stories}
                      onChange={(event) => updateHn({ fetch_top_stories: Number(event.target.value) })}
                    />
                  </div>
                </div>
              </div>

              <div className="source-block">
                <div className="source-block__head">
                  <label className="checkbox-row" htmlFor="gn-enabled">
                    <input
                      id="gn-enabled"
                      type="checkbox"
                      checked={sources.google_news.enabled}
                      onChange={(event) => updateGn({ enabled: event.target.checked })}
                    />
                    Google News 通用检索
                  </label>
                  <span>关键词在上方统一设置</span>
                </div>
                <div className="source-block__fields">
                  <div className="form-field">
                    <label htmlFor="gn-max">每次条数</label>
                    <input
                      id="gn-max"
                      type="number"
                      min={1}
                      max={100}
                      className="field"
                      value={sources.google_news.max_results}
                      onChange={(event) => updateGn({ max_results: Number(event.target.value) })}
                    />
                  </div>
                </div>
              </div>

              <div className="source-block">
                <div className="source-block__head">
                  <h3>RSS 订阅</h3>
                  <span>{sources.rss.filter((feed) => !isGoogleNewsSearchFeed(feed.url)).length} 个</span>
                </div>
                <div className="rss-groups">
                  {TOPICS.map((topic) => {
                    const rows = sources.rss
                      .map((feed, index) => ({ feed, index }))
                      .filter(
                        ({ feed }) =>
                          (feed.profile || "ai-news") === topic.id &&
                          !isGoogleNewsSearchFeed(feed.url),
                      );
                    if (!rows.length) return null;
                    return (
                      <div className="rss-group" key={topic.id}>
                        <div className="rss-group__head">
                          <h4>{topic.label}</h4>
                          <span>{rows.length} 个</span>
                        </div>
                        <ul className="rss-list">
                          {rows.map(({ feed, index }) => (
                            <li className="rss-row" key={index}>
                              <input
                                type="checkbox"
                                checked={feed.enabled}
                                aria-label="启用这个订阅"
                                onChange={(event) => updateFeed(index, { enabled: event.target.checked })}
                              />
                              <input
                                className="field"
                                value={feed.name}
                                aria-label="订阅名称"
                                placeholder="名称"
                                onChange={(event) => updateFeed(index, { name: event.target.value })}
                              />
                              <input
                                className="field"
                                value={feed.url}
                                aria-label="RSS 地址"
                                placeholder="https://example.com/feed.xml"
                                onChange={(event) => updateFeed(index, { url: event.target.value })}
                              />
                              <select
                                className="field field--topic"
                                value={feed.profile || "ai-news"}
                                aria-label="所属主题"
                                onChange={(event) => updateFeed(index, { profile: event.target.value })}
                              >
                                {TOPICS.map((option) => (
                                  <option key={option.id} value={option.id}>{option.label}</option>
                                ))}
                              </select>
                              <button type="button" className="key key--small" onClick={() => removeFeed(index)}>
                                删除
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="actions">
                <button type="button" className="key" onClick={addFeed}>添加 RSS</button>
                <button
                  type="button"
                  className="key key--primary"
                  onClick={() => void saveSources("all")}
                  disabled={sourceSaving}
                >
                  {sourceSaving ? "保存中…" : "保存来源设置"}
                </button>
              </div>
              <p className={sourceError ? "message message--error" : "message message--ok"} aria-live="polite">
                {sourceError || sourceMessage}
              </p>
            </>
          ) : (
            <p className="status-line">{sourceError || "正在读取来源配置…"}</p>
          )}
        </section>
      </main>
    </div>
  );
}
