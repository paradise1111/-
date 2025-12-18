export interface NewsItem {
  title_cn: string;
  title_en: string;
  summary_cn: string;
  summary_en: string;
  source_url: string;
  source_name: string;
}

export interface GeneratedContent {
  viral_titles: string[]; // Global/General viral titles
  medical_viral_titles: string[]; // New: Health specific viral titles
  general_news: NewsItem[];
  medical_news: NewsItem[];
  date: string;
}

export enum AppStatus {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  SEARCHING = 'SEARCHING',
  GENERATING = 'GENERATING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
}

export interface ModelConfig {
  id: string;
  name: string;
  description: string;
}