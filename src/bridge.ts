import type { Bridge, Settings } from './types';
const defaultSettings: Settings = {
  theme: 'system',
  glass: true,
  shortcut: 'Alt+Space',
  voiceMode: 'auto',
  startup: false,
  clipboard: false,
  trust: 'cautious',
  developer: false,
  content: true,
  setup: false,
  roots: [],
  exclusions: [],
  ai: { provider: 'off', model: '', speechCloud: false },
  recoveryDays: 0,
  confirmConversions: true,
};
let previewSettings = { ...defaultSettings };
export const desktop = !!window.flare;
const transport: Bridge = window.flare || {
  async call(method, data) {
    if (method === 'snapshot')
      return {
        settings: previewSettings,
        index: { state: 'idle', count: 0, current: '' },
        count: 0,
        version: '0.1.0',
        portable: true,
        dark: true,
        roots: [],
      };
    if (method === 'settings') {
      previewSettings = { ...previewSettings, ...data };
      return previewSettings;
    }
    if (method === 'search') return [];
    if (['history', 'drives', 'models'].includes(method)) return [];
    if (
      ['resize', 'hide', 'ai-cancel', 'voice-cancel', 'cancel', 'clipboard-clear'].includes(method)
    )
      return true;
    throw new Error('This action needs the Flare desktop app.');
  },
  on() {
    return () => {};
  },
};
export const bridge: Bridge = {
  on: (event, callback) => transport.on(event, callback),
  async call(method, data) {
    try {
      return await transport.call(method, data);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'This action could not be completed.';
      throw new Error(message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''));
    }
  },
};
export const basename = (value: string) => value.split(/[\\/]/).pop() || value;
export function fileSize(bytes: number = 0) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
