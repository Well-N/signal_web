export type Section = {
  id: string;
  title: string;
  story_ids: string[];
};

export type ArtifactBlock = {
  id: string;
  type?: string;
  title: string;
  content: string;
  source_refs?: string[];
  primary?: boolean;
};

export type ArtifactSource = {
  id: string;
  title: string;
  url: string;
};

export type StoryArtifact = {
  language: string;
  title: string;
  blocks: ArtifactBlock[];
  sources?: ArtifactSource[];
};

export type Story = {
  id: string;
  title: string;
  url: string;
  source: string;
  source_type: string;
  author?: string | null;
  published_at: string;
  fetched_at: string;
  category?: string | null;
  profile?: string | string[] | null;
  score?: number | null;
  reason?: string | null;
  one_liner?: string | null;
  tags?: string[];
  artifact?: StoryArtifact | null;
  bilingual?: Record<string, { zh: string; en: string }>;
  metadata?: Record<string, unknown>;
};

export type GraphEdge = {
  source: string;
  target: string;
  kind: string;
  weight?: number;
  label?: string;
};

export type SourceHealth = {
  source: string;
  status: string;
  item_count: number;
  error?: string;
};

export type FetchReport = {
  status?: string;
  attempted?: number;
  successful?: number;
  failed?: number;
  item_count?: number;
  sources?: SourceHealth[];
};

export type Brief = {
  version: number;
  is_sample: boolean;
  date: string;
  language: string;
  generated_at: string;
  headline: string;
  summary_markdown: string;
  sections: Section[];
  stories: Story[];
  edges: GraphEdge[];
  fetch_report?: FetchReport;
  stats: {
    story_count: number;
    source_count: number;
  };
};
