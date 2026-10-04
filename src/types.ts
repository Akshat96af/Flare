export type Result = {
  id: string;
  title: string;
  kind: string;
  detail: string;
  path?: string;
  icon?: string;
  intent?: any;
  contentMatch?: boolean;
  size?: number;
  modified?: number;
};
export type Settings = {
  theme: string;
  glass: boolean;
  shortcut: string;
  voiceMode: string;
  startup: boolean;
  clipboard: boolean;
  trust: string;
  developer: boolean;
  content: boolean;
  setup: boolean;
  roots: string[];
  exclusions: string[];
  ai: {
    provider: string;
    model: string;
    speechCloud: boolean;
    speechMode?: 'fallback' | 'online';
    speechModel?: string;
  };
  recoveryDays: number;
  confirmConversions: boolean;
};
export type IndexStatus = { state: string; count: number; current: string; failures?: number };
export type Operation = {
  id: string;
  title: string;
  type: string;
  created: number;
  status: string;
  items: {
    from: string;
    to: string;
    size: number;
    status: string;
    error?: string;
    reason?: string;
    outputSize?: number;
  }[];
};
export interface Bridge {
  call(method: string, data?: any): Promise<any>;
  on(event: string, callback: (data: any) => void): () => void;
}
declare global {
  interface Window {
    flare?: Bridge;
  }
}
