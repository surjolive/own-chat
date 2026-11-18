export type ProviderStatus = 'READY' | 'UNAVAILABLE' | 'ERROR';

export interface AIProvider {
  providerName: 'OMNIROUTE' | 'OLLAMA';
  testConnection(): Promise<boolean>;
  listModels(): Promise<string[]>;
  generateResponse(prompt: string): Promise<string>;
  supportsVision(): boolean;
  getProviderStatus(): Promise<ProviderStatus>;
}

export class OllamaProvider implements AIProvider {
  providerName = 'OLLAMA' as const;

  async testConnection(): Promise<boolean> {
    return true;
  }

  async listModels(): Promise<string[]> {
    return ['llama3.2'];
  }

  async generateResponse(prompt: string): Promise<string> {
    return `Ollama response for: ${prompt}`;
  }

  supportsVision(): boolean {
    return false;
  }

  async getProviderStatus(): Promise<ProviderStatus> {
    return 'READY';
  }
}

export class OmniRouteProvider implements AIProvider {
  providerName = 'OMNIROUTE' as const;

  async testConnection(): Promise<boolean> {
    return true;
  }

  async listModels(): Promise<string[]> {
    return ['gpt-4o-mini'];
  }

  async generateResponse(prompt: string): Promise<string> {
    return `OmniRoute response for: ${prompt}`;
  }

  supportsVision(): boolean {
    return true;
  }

  async getProviderStatus(): Promise<ProviderStatus> {
    return 'READY';
  }
}
