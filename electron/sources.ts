import { app } from 'electron';
import path from 'path';
import fs from 'fs';

export interface SourceConfig {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  type?: string;
  folderKey?: string;
  selectors: {
    gameList: string;
    gameTitle: string;
    gameLink: string;
    gameImage: string;
    downloadButton: string;
    downloadTable: string;
    downloadRow: string;
    downloadName: string;
    downloadUrl: string;
    downloadSize: string;
    downloadFormat: string;
    directDownloadLink: string;
    coverImage: string[];
  };
  paths: {
    search: string;
    latest: string;
    popular: string;
  };
}

export interface FirmwareSource {
  id: string;
  name: string;
  url: string;
  version: string;
}

export interface EmulatorConfig {
  id: string;
  name: string;
  path: string;
  args: string;
  extensions: string[];
}

export interface AppConfig {
  sources: SourceConfig[];
  firmwareSources: FirmwareSource[];
  emulators: EmulatorConfig[];
}

const DEFAULT_CONFIG: AppConfig = {
  sources: [],
  firmwareSources: [],
  emulators: []
};

function getConfigPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'sources.json');
}

export function loadConfig(): AppConfig {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      const loaded = JSON.parse(data);
      return {
        sources: loaded.sources || DEFAULT_CONFIG.sources,
        firmwareSources: loaded.firmwareSources || [],
        emulators: loaded.emulators || []
      };
    }
  } catch (err) {
    console.error('Error loading config:', err);
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(config: AppConfig): void {
  const configPath = getConfigPath();
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving config:', err);
    throw err;
  }
}

export function addSource(source: SourceConfig): AppConfig {
  const config = loadConfig();
  const existing = config.sources.findIndex(s => s.id === source.id);
  if (existing >= 0) {
    config.sources[existing] = source;
  } else {
    config.sources.push(source);
  }
  saveConfig(config);
  return config;
}

export function removeSource(sourceId: string): AppConfig {
  const config = loadConfig();
  config.sources = config.sources.filter(s => s.id !== sourceId);
  saveConfig(config);
  return config;
}

export function addEmulator(emulator: EmulatorConfig): AppConfig {
  const config = loadConfig();
  const existing = config.emulators.findIndex(e => e.id === emulator.id);
  if (existing >= 0) {
    config.emulators[existing] = emulator;
  } else {
    config.emulators.push(emulator);
  }
  saveConfig(config);
  return config;
}

export function removeEmulator(emulatorId: string): AppConfig {
  const config = loadConfig();
  config.emulators = config.emulators.filter(e => e.id !== emulatorId);
  saveConfig(config);
  return config;
}

export function addFirmwareSource(firmware: FirmwareSource): AppConfig {
  const config = loadConfig();
  const existing = config.firmwareSources.findIndex(f => f.id === firmware.id);
  if (existing >= 0) {
    config.firmwareSources[existing] = firmware;
  } else {
    config.firmwareSources.push(firmware);
  }
  saveConfig(config);
  return config;
}

export function removeFirmwareSource(firmwareId: string): AppConfig {
  const config = loadConfig();
  config.firmwareSources = config.firmwareSources.filter(f => f.id !== firmwareId);
  saveConfig(config);
  return config;
}

export function getEnabledSources(): SourceConfig[] {
  const config = loadConfig();
  return config.sources.filter(s => s.enabled);
}
