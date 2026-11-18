import { z } from 'zod';

export interface OmniRouteSettings {
  userId: string;
  baseUrl: string;
  apiKey?: string;
  defaultModel?: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface OmniRouteConnectionResult {
  ok: boolean;
  message: string;
  models?: string[];
}

const settingsSchema = z.object({
  baseUrl: z.string().url().default('http://127.0.0.1:20128'),
  apiKey: z.string().trim().optional(),
  defaultModel: z.string().trim().optional(),
  enabled: z.boolean().default(false),
});

type OmniRouteClient = typeof fetch | { fetch: typeof fetch };

export function createOmniRouteService({
  client = globalThis.fetch,
}: {
  client?: OmniRouteClient;
} = {}) {
  const settings = new Map<string, OmniRouteSettings>();

  const defaultBaseUrl = 'http://127.0.0.1:20128';
  const fetcher = typeof client === 'function' ? client : client?.fetch ?? globalThis.fetch;

  const getCurrent = (userId: string) => {
    const current = settings.get(userId);
    if (current) return current;

    const fallback: OmniRouteSettings = {
      userId,
      baseUrl: defaultBaseUrl,
      enabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    settings.set(userId, fallback);
    return fallback;
  };

  async function probeModels(baseUrl: string, apiKey?: string): Promise<string[]> {
    const urls = [
      `${baseUrl.replace(/\/$/, '')}/models`,
      `${baseUrl.replace(/\/$/, '')}/v1/models`,
      `${baseUrl.replace(/\/$/, '')}/api/models`,
    ];

    for (const url of urls) {
      try {
        const response = await fetcher(url, {
          method: 'GET',
          headers: {
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            Accept: 'application/json',
          },
        });

        if (!response.ok) continue;
        const data = (await response.json()) as Record<string, unknown>;
        const modelList = Array.isArray(data.models)
          ? data.models.map((model) => String((model as { id?: string }).id ?? (model as { name?: string }).name ?? ''))
          : Array.isArray(data.data)
            ? data.data.map((model) => String((model as { id?: string }).id ?? ''))
            : [];

        const filtered = modelList.filter(Boolean);
        if (filtered.length > 0) return filtered;
      } catch {
        // continue probing different endpoints
      }
    }

    return [];
  }

  return {
    getSettings(userId: string): OmniRouteSettings {
      return getCurrent(userId);
    },

    async saveSettings(userId: string, payload: unknown): Promise<OmniRouteSettings> {
      const parsed = settingsSchema.parse(payload);
      const current = getCurrent(userId);
      const next: OmniRouteSettings = {
        ...current,
        baseUrl: parsed.baseUrl,
        apiKey: parsed.apiKey?.trim() || current.apiKey,
        defaultModel: parsed.defaultModel ?? current.defaultModel,
        enabled: parsed.enabled,
        updatedAt: new Date(),
      };
      settings.set(userId, next);
      return next;
    },

    async testConnection(userId: string): Promise<OmniRouteConnectionResult> {
      const current = getCurrent(userId);
      if (!current.enabled) {
        return { ok: false, message: 'OmniRoute is disabled for this account.' };
      }

      const urls = [
        `${current.baseUrl.replace(/\/$/, '')}/health`,
        `${current.baseUrl.replace(/\/$/, '')}/v1/health`,
        `${current.baseUrl.replace(/\/$/, '')}`,
      ];

      for (const url of urls) {
        try {
          const response = await fetcher(url, {
            method: 'GET',
            headers: {
              ...(current.apiKey ? { Authorization: `Bearer ${current.apiKey}` } : {}),
              Accept: 'application/json',
            },
          });

          if (response.ok) {
            const models = await probeModels(current.baseUrl, current.apiKey);
            return { ok: true, message: 'OmniRoute is reachable.', models };
          }
        } catch {
          // try next URL
        }
      }

      return {
        ok: false,
        message: 'Could not reach OmniRoute at the configured endpoint.',
      };
    },

    async generateResponse(
      userId: string,
      prompt: string,
      currentSettings: OmniRouteSettings = getCurrent(userId),
    ): Promise<string> {
      if (!currentSettings.enabled) {
        throw new Error('OmniRoute is disabled for this account.');
      }

      if (!currentSettings.defaultModel) {
        throw new Error('Configure an OmniRoute model before generating responses.');
      }

      const body = {
        model: currentSettings.defaultModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      };

      const urls = [
        `${currentSettings.baseUrl.replace(/\/$/, '')}/chat/completions`,
        `${currentSettings.baseUrl.replace(/\/$/, '')}/v1/chat/completions`,
      ];

      for (const url of urls) {
        try {
          const response = await fetcher(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(currentSettings.apiKey ? { Authorization: `Bearer ${currentSettings.apiKey}` } : {}),
            },
            body: JSON.stringify(body),
          });

          if (!response.ok) continue;

          const data = (await response.json()) as Record<string, unknown>;
          const content =
            (data as any)?.choices?.[0]?.message?.content ??
            (data as any)?.output?.[0]?.content ??
            (data as any)?.content ??
            '';

          if (typeof content === 'string' && content.trim()) return content.trim();
          if (Array.isArray(content)) {
            const joined = content
              .map((part) => (typeof part === 'string' ? part : (part as { text?: string })?.text ?? ''))
              .join(' ')
              .trim();
            if (joined) return joined;
          }
        } catch {
          // try the next supported endpoint
        }
      }

      throw new Error('OmniRoute did not return a response from the configured endpoint.');
    },

    async listModels(userId: string): Promise<string[]> {
      const current = getCurrent(userId);
      return probeModels(current.baseUrl, current.apiKey);
    },
  };
}
