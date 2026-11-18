import { describe, expect, it } from 'vitest';
import { createOmniRouteService } from './omniroute.js';

describe('omniroute service', () => {
  it('generates a draft from the configured model response', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const service = createOmniRouteService({
      client: {
        async fetch(_url: string, init?: RequestInit) {
          requestBody = JSON.parse(String(init?.body));
          return {
            ok: true,
            json: async () => ({ choices: [{ message: { content: 'Thanks for reaching out.' } }] }),
          } as Response;
        },
      } as any,
    });

    await service.saveSettings('user-draft', {
      baseUrl: 'http://127.0.0.1:20128',
      defaultModel: 'test-model',
      enabled: true,
    });

    await expect(service.generateResponse('user-draft', 'Write a short reply')).resolves.toBe('Thanks for reaching out.');
    expect(requestBody).toMatchObject({
      model: 'test-model',
      messages: [{ role: 'user', content: 'Write a short reply' }],
    });
  });

  it('stores a valid config and can test connectivity', async () => {
    const service = createOmniRouteService({
      client: {
        async fetch() {
          return {
            ok: true,
            json: async () => ({ models: [{ id: 'gpt-4o-mini' }] }),
          } as Response;
        },
      } as any,
    });

    const config = await service.saveSettings('user-1', {
      baseUrl: 'http://127.0.0.1:20128',
      apiKey: 'abc',
      defaultModel: 'gpt-4o-mini',
      enabled: true,
    });

    expect(config.defaultModel).toBe('gpt-4o-mini');
    const connection = await service.testConnection('user-1');
    expect(connection.ok).toBe(true);
  });

  it('does not fabricate model lists or responses when the provider is unavailable', async () => {
    const service = createOmniRouteService({
      client: {
        async fetch() {
          throw new Error('provider offline');
        },
      } as any,
    });

    expect(await service.listModels('user-offline')).toEqual([]);
    await expect(service.generateResponse('user-offline', 'hello')).rejects.toThrow('disabled');
  });
});
