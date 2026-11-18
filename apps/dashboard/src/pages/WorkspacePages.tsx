import { FormEvent, useEffect, useState } from 'react';
import { RefreshCw, Save, Search } from 'lucide-react';

type ApiRequest = (path: string, method?: string, body?: unknown) => Promise<any>;

type UserProfile = {
  username: string;
  email: string;
  role: string;
  createdAt?: string;
};

type AccountSummary = {
  id: string;
  displayName: string;
  connectionStatus: string;
  phoneNumber?: string;
};

type Conversation = {
  id: string;
  chatId: string;
  title?: string | null;
  status: string;
  updatedAt: string;
  account?: { displayName: string | null; phoneNumber: string | null } | null;
  messages: Array<{
    id: string;
    senderType: string;
    content?: string | null;
    messageType: string;
    createdAt: string;
    deliveryStatus: string;
  }>;
};

type ContactPolicy = {
  id: string;
  contactId: string;
  optedIn: boolean;
  blocked: boolean;
  autoReplyEnabled: boolean;
  updatedAt: string;
};

type BotSettings = {
  autoReplyEnabled: boolean;
  personality: string;
  language: string;
  systemPrompt: string;
};

type OmniRouteSettings = {
  baseUrl: string;
  apiKey?: string;
  hasApiKey?: boolean;
  defaultModel?: string;
  enabled: boolean;
};

type ActivityEvent = {
  id: string;
  event: string;
  resourceType?: string | null;
  resourceId?: string | null;
  createdAt: string;
};

export async function apiRequest(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(path, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message ?? data?.error ?? `Request failed (${response.status})`);
  }
  return data;
}

const defaultBotSettings: BotSettings = {
  autoReplyEnabled: false,
  personality: '',
  language: 'en',
  systemPrompt: '',
};

const panelStyle = {
  background: '#0f172a',
  border: '1px solid rgba(148,163,184,0.2)',
  borderRadius: 12,
  padding: 20,
};

const inputStyle = {
  width: '100%',
  minWidth: 0,
  background: '#020817',
  border: '1px solid #334155',
  borderRadius: 8,
  padding: '10px 12px',
  color: '#f8fafc',
};

const buttonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  background: '#15803d',
  border: 0,
  borderRadius: 8,
  padding: '9px 12px',
  color: '#fff',
  cursor: 'pointer',
};

function EmptyState({ children }: { children: string }) {
  return <div className="empty-state">{children}</div>;
}

export default function WorkspacePages({
  page,
  currentUser,
  accounts,
  onNavigate,
}: {
  page: string;
  currentUser: UserProfile | null;
  accounts: AccountSummary[];
  onNavigate: (page: string) => void;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [contacts, setContacts] = useState<ContactPolicy[]>([]);
  const [botSettings, setBotSettings] = useState<BotSettings>(defaultBotSettings);
  const [aiSettings, setAiSettings] = useState<OmniRouteSettings>({
    baseUrl: 'http://127.0.0.1:20128',
    apiKey: '',
    defaultModel: '',
    enabled: false,
  });
  const [models, setModels] = useState<string[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [search, setSearch] = useState('');
  const [newContactId, setNewContactId] = useState('');
  const [newContactOptIn, setNewContactOptIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [aiTest, setAiTest] = useState('');
  const [health, setHealth] = useState<{ status: string; dependencies?: Record<string, string> } | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError('');
      setNotice('');
      try {
        if (page === 'Overview') {
          const [conversationData, activityData] = await Promise.all([
            apiRequest('/api/v1/conversations'),
            apiRequest('/api/v1/activity'),
          ]);
          if (active) {
            setConversations(conversationData.conversations ?? []);
            setActivity(activityData.events ?? []);
          }
        } else if (page === 'Conversations' || page === 'Memory') {
          const data = await apiRequest('/api/v1/conversations');
          if (active) setConversations(data.conversations ?? []);
        } else if (page === 'Contacts') {
          const data = await apiRequest('/api/v1/contacts');
          if (active) setContacts(data.contacts ?? []);
        } else if (page === 'Bot Personality' || page === 'Automation') {
          const data = await apiRequest('/api/v1/bot/settings');
          if (active) setBotSettings({ ...defaultBotSettings, ...data.settings });
        } else if (page === 'AI Settings') {
          const [settingsData, modelData] = await Promise.all([
            apiRequest('/api/v1/ai/settings'),
            apiRequest('/api/v1/ai/models'),
          ]);
          if (active) {
            setAiSettings({
              baseUrl: settingsData.settings.baseUrl,
              apiKey: '',
              hasApiKey: settingsData.settings.hasApiKey ?? false,
              defaultModel: settingsData.settings.defaultModel ?? '',
              enabled: settingsData.settings.enabled,
            });
            setModels(modelData.models ?? []);
          }
        } else if (page === 'Activity Logs') {
          const data = await apiRequest('/api/v1/activity');
          if (active) setActivity(data.events ?? []);
        } else if (page === 'Help & Documentation') {
          const data = await apiRequest('/health');
          if (active) setHealth(data);
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to load this page.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => { active = false; };
  }, [page]);

  const saveBotSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const data = await apiRequest('/api/v1/bot/settings', 'PATCH', botSettings);
      setBotSettings({ ...defaultBotSettings, ...data.settings });
      setNotice('Settings saved.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const saveAiSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const data = await apiRequest('/api/v1/ai/settings', 'PATCH', aiSettings);
      setAiSettings({
        baseUrl: data.settings.baseUrl,
        apiKey: '',
        hasApiKey: data.settings.hasApiKey ?? false,
        defaultModel: data.settings.defaultModel ?? '',
        enabled: data.settings.enabled,
      });
      setNotice('OmniRoute settings saved.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save provider settings.');
    } finally {
      setSaving(false);
    }
  };

  const testAiConnection = async () => {
    setSaving(true);
    setError('');
    setAiTest('');
    try {
      const data = await apiRequest('/api/v1/ai/settings', 'PATCH', aiSettings);
      setAiSettings({ ...aiSettings, apiKey: '', hasApiKey: data.settings.hasApiKey ?? false });
      const result = await apiRequest('/api/v1/ai/test', 'POST', {});
      setAiTest(result.message);
      if (result.models?.length) setModels(result.models);
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : 'Provider test failed.');
    } finally {
      setSaving(false);
    }
  };

  const reloadModels = async () => {
    setSaving(true);
    setError('');
    try {
      await apiRequest('/api/v1/ai/settings', 'PATCH', aiSettings);
      const data = await apiRequest('/api/v1/ai/models');
      setModels(data.models ?? []);
      setNotice(`${(data.models ?? []).length} model(s) found.`);
    } catch (modelError) {
      setError(modelError instanceof Error ? modelError.message : 'Unable to load models.');
    } finally {
      setSaving(false);
    }
  };

  const createContact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const data = await apiRequest('/api/v1/contacts', 'POST', {
        contactId: newContactId,
        optedIn: newContactOptIn,
      });
      setContacts((current) => [data.contact, ...current]);
      setNewContactId('');
      setNewContactOptIn(false);
      setNotice('Contact policy added.');
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to add contact.');
    } finally {
      setSaving(false);
    }
  };

  const updateContact = async (contact: ContactPolicy, field: 'optedIn' | 'blocked' | 'autoReplyEnabled') => {
    setError('');
    try {
      const data = await apiRequest(`/api/v1/contacts/${contact.id}`, 'PATCH', { [field]: !contact[field] });
      setContacts((current) => current.map((item) => item.id === contact.id ? data.contact : item));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update contact policy.');
    }
  };

  const filteredConversations = conversations.filter((conversation) => {
    const query = search.trim().toLowerCase();
    return !query || `${conversation.title ?? ''} ${conversation.chatId} ${conversation.account?.displayName ?? ''}`.toLowerCase().includes(query);
  });

  const filteredContacts = contacts.filter((contact) => contact.contactId.toLowerCase().includes(search.trim().toLowerCase()));

  const pageHeading = loading ? <div className="page-loading">Loading…</div> : null;
  const feedback = (
    <>
      {error ? <div className="page-message error" role="alert">{error}</div> : null}
      {notice ? <div className="page-message success" role="status">{notice}</div> : null}
    </>
  );

  if (page === 'Overview') {
    return (
      <section className="page-stack">
        {pageHeading}
        {feedback}
        <article className="workspace-panel">
          <div className="workspace-heading"><h2>Accounts</h2><button type="button" className="action-button" onClick={() => onNavigate('WhatsApp Accounts')}>Manage accounts</button></div>
          {accounts.length ? (
            <div className="record-list">
              {accounts.map((account) => <div className="record-row" key={account.id}><strong>{account.displayName}</strong><span>{account.phoneNumber ?? 'No phone number'}</span><span className={`status-tag ${account.connectionStatus === 'CONNECTED' ? 'positive' : ''}`}>{account.connectionStatus}</span></div>)}
            </div>
          ) : <EmptyState>No WhatsApp accounts have been added.</EmptyState>}
        </article>
        <article className="workspace-panel">
          <div className="workspace-heading">
            <h2>All chats</h2>
            <button type="button" className="secondary-button" onClick={() => onNavigate('Conversations')}>Open conversations</button>
          </div>
          {conversations.length ? (
            <div className="record-list">
              {conversations.map((conversation) => (
                <div className="record-row conversation-row" key={conversation.id}>
                  <div><strong>{conversation.title || conversation.chatId}</strong><small>{conversation.account?.displayName ?? 'WhatsApp account'} · {conversation.status}</small></div>
                  <span>{conversation.messages[0]?.content || 'No messages recorded'}</span>
                  <time>{new Date(conversation.updatedAt).toLocaleString()}</time>
                </div>
              ))}
            </div>
          ) : <EmptyState>{loading ? 'Loading chats…' : 'No chats have been recorded yet.'}</EmptyState>}
        </article>
        <article className="workspace-panel">
          <div className="workspace-heading">
            <h2>All messages</h2>
            <button type="button" className="secondary-button" onClick={() => onNavigate('Memory')}>Open message history</button>
          </div>
          {conversations.some((conversation) => conversation.messages.length > 0) ? (
            <div className="record-list">
              {conversations.flatMap((conversation) => conversation.messages.map((message) => ({ conversation, message })))
                .sort((left, right) => new Date(right.message.createdAt).getTime() - new Date(left.message.createdAt).getTime())
                .map(({ conversation, message }) => (
                  <div className="record-row conversation-row" key={message.id}>
                    <div><strong>{conversation.title || conversation.chatId}</strong><small>{conversation.account?.displayName ?? 'WhatsApp account'} · {message.senderType} · {message.deliveryStatus}</small></div>
                    <span>{message.content || `[${message.messageType}]`}</span>
                    <time>{new Date(message.createdAt).toLocaleString()}</time>
                  </div>
                ))}
            </div>
          ) : <EmptyState>{loading ? 'Loading messages…' : 'No messages have been recorded yet.'}</EmptyState>}
        </article>
        <article className="workspace-panel">
          <div className="workspace-heading">
            <h2>All activity</h2>
            <button type="button" className="secondary-button" onClick={() => onNavigate('Activity Logs')}>Open activity logs</button>
          </div>
          {activity.length ? (
            <div className="record-list">
              {activity.map((event) => (
                <div className="record-row" key={event.id}>
                  <strong>{event.event}</strong>
                  <span>{event.resourceType ?? 'System'}{event.resourceId ? ` · ${event.resourceId}` : ''}</span>
                  <time>{new Date(event.createdAt).toLocaleString()}</time>
                </div>
              ))}
            </div>
          ) : <EmptyState>{loading ? 'Loading activity…' : 'No activity has been recorded yet.'}</EmptyState>}
        </article>
        <article className="workspace-panel">
          <div className="workspace-heading">
            <h2>Profile</h2>
            <button type="button" className="secondary-button" onClick={() => onNavigate('Profile')}>Profile settings</button>
          </div>
          <div className="profile-grid">
            <div><span>Username</span><strong>{currentUser?.username ?? '—'}</strong></div>
            <div><span>Email</span><strong>{currentUser?.email ?? '—'}</strong></div>
            <div><span>Role</span><strong>{currentUser?.role ?? '—'}</strong></div>
            <div><span>WhatsApp accounts</span><strong>{accounts.length}</strong></div>
          </div>
        </article>
        <article className="workspace-panel">
          <div className="workspace-heading"><h2>Workspace</h2></div>
          <div className="quick-links">
            {['Conversations', 'AI Settings', 'Contacts', 'Activity Logs'].map((item) => <button type="button" className="quick-link" key={item} onClick={() => onNavigate(item)}>{item}</button>)}
          </div>
        </article>
      </section>
    );
  }

  if (page === 'Conversations') {
    return (
      <section className="page-stack">
        {pageHeading}
        {feedback}
        <div className="workspace-panel">
          <label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search chats" /></label>
          {filteredConversations.length ? (
            <div className="record-list">
              {filteredConversations.map((conversation) => (
                <article className="record-row conversation-row" key={conversation.id}>
                  <div><strong>{conversation.title || conversation.chatId}</strong><small>{conversation.account?.displayName ?? 'WhatsApp account'} · {conversation.status}</small></div>
                  <span>{conversation.messages[0]?.content || 'No messages recorded'}</span>
                  <time>{new Date(conversation.updatedAt).toLocaleString()}</time>
                </article>
              ))}
            </div>
          ) : <EmptyState>{loading ? 'Loading conversations…' : 'No conversations have been recorded yet.'}</EmptyState>}
        </div>
      </section>
    );
  }

  if (page === 'AI Settings') {
    return (
      <section className="page-stack">
        {pageHeading}
        {feedback}
        <form className="workspace-panel form-grid" onSubmit={saveAiSettings}>
          <label>OmniRoute endpoint<input style={inputStyle} type="url" required value={aiSettings.baseUrl} onChange={(event) => setAiSettings({ ...aiSettings, baseUrl: event.target.value })} /></label>
          <label>API key<input style={inputStyle} type="password" autoComplete="new-password" value={aiSettings.apiKey ?? ''} placeholder={aiSettings.hasApiKey ? 'Saved securely; leave blank to keep it' : 'Enter your OmniRoute API key'} onChange={(event) => setAiSettings({ ...aiSettings, apiKey: event.target.value })} /></label>
          <label>Default model
            <input style={inputStyle} list="omniroute-models" value={aiSettings.defaultModel ?? ''} onChange={(event) => setAiSettings({ ...aiSettings, defaultModel: event.target.value })} placeholder="Select or enter a model ID" />
            <datalist id="omniroute-models">{models.map((model) => <option value={model} key={model} />)}</datalist>
          </label>
          <label className="check-field"><input type="checkbox" checked={aiSettings.enabled} onChange={(event) => setAiSettings({ ...aiSettings, enabled: event.target.checked })} /> Enable OmniRoute</label>
          <div className="button-row">
            <button type="submit" className="action-button" disabled={saving}><Save size={16} />Save settings</button>
            <button type="button" className="secondary-button" onClick={reloadModels} disabled={saving}><RefreshCw size={16} />Load models</button>
            <button type="button" className="secondary-button" onClick={testAiConnection} disabled={saving}>Test connection</button>
          </div>
          {aiTest ? <div className="page-message">{aiTest}</div> : null}
          {models.length ? <div className="model-list">Available models: {models.join(', ')}</div> : null}
        </form>
      </section>
    );
  }

  if (page === 'Bot Personality') {
    return (
      <section className="page-stack">
        {pageHeading}
        {feedback}
        <form className="workspace-panel form-grid" onSubmit={saveBotSettings}>
          <label>Personality<input style={inputStyle} maxLength={120} value={botSettings.personality} onChange={(event) => setBotSettings({ ...botSettings, personality: event.target.value })} placeholder="Friendly, concise, professional" /></label>
          <label>Reply language<input style={inputStyle} maxLength={20} value={botSettings.language} onChange={(event) => setBotSettings({ ...botSettings, language: event.target.value })} /></label>
          <label className="full-field">System prompt<textarea style={inputStyle} maxLength={4000} rows={8} value={botSettings.systemPrompt} onChange={(event) => setBotSettings({ ...botSettings, systemPrompt: event.target.value })} placeholder="Define the assistant's role and response boundaries" /></label>
          <div className="button-row"><button type="submit" className="action-button" disabled={saving}><Save size={16} />Save personality</button></div>
        </form>
      </section>
    );
  }

  if (page === 'Automation') {
    return (
      <section className="page-stack">
        {pageHeading}
        {feedback}
        <form className="workspace-panel form-grid" onSubmit={saveBotSettings}>
          <label className="check-field"><input type="checkbox" checked={botSettings.autoReplyEnabled} onChange={(event) => setBotSettings({ ...botSettings, autoReplyEnabled: event.target.checked })} />Enable auto-reply preference</label>
          <label>Default reply language<input style={inputStyle} value={botSettings.language} onChange={(event) => setBotSettings({ ...botSettings, language: event.target.value })} /></label>
          <div className="page-message">When enabled with a configured OmniRoute model, direct incoming messages receive an AI reply. Blocked, opted-out, and contact-specific disabled policies are skipped.</div>
          <div className="button-row"><button type="submit" className="action-button" disabled={saving}><Save size={16} />Save automation settings</button><button type="button" className="secondary-button" onClick={() => onNavigate('Contacts')}>Manage contact policies</button></div>
        </form>
      </section>
    );
  }

  if (page === 'Contacts') {
    return (
      <section className="page-stack">
        {pageHeading}
        {feedback}
        <form className="workspace-panel inline-form" onSubmit={createContact}>
          <label>Phone number or WhatsApp ID<input style={inputStyle} required minLength={3} maxLength={120} value={newContactId} onChange={(event) => setNewContactId(event.target.value)} placeholder="15551234567@s.whatsapp.net" /></label>
          <label className="check-field"><input type="checkbox" checked={newContactOptIn} onChange={(event) => setNewContactOptIn(event.target.checked)} />Contact opted in</label>
          <button type="submit" className="action-button" disabled={saving}>Add policy</button>
        </form>
        <div className="workspace-panel">
          <label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter contacts" /></label>
          {filteredContacts.length ? (
            <div className="table-scroll"><table className="data-table"><thead><tr><th>Contact</th><th>Opted in</th><th>Blocked</th><th>Auto reply</th></tr></thead><tbody>
              {filteredContacts.map((contact) => <tr key={contact.id}><td>{contact.contactId}</td><td><input aria-label={`Opt-in ${contact.contactId}`} type="checkbox" checked={contact.optedIn} onChange={() => void updateContact(contact, 'optedIn')} /></td><td><input aria-label={`Block ${contact.contactId}`} type="checkbox" checked={contact.blocked} onChange={() => void updateContact(contact, 'blocked')} /></td><td><input aria-label={`Auto reply ${contact.contactId}`} type="checkbox" checked={contact.autoReplyEnabled} onChange={() => void updateContact(contact, 'autoReplyEnabled')} /></td></tr>)}
            </tbody></table></div>
          ) : <EmptyState>{loading ? 'Loading contact policies…' : 'No contact policies have been added.'}</EmptyState>}
        </div>
      </section>
    );
  }

  if (page === 'Memory') {
    return (
      <section className="page-stack">
        {pageHeading}
        {feedback}
        <div className="workspace-panel">
          <label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search message history" /></label>
          {filteredConversations.length ? filteredConversations.map((conversation) => (
            <article className="memory-group" key={conversation.id}>
              <div className="workspace-heading"><strong>{conversation.title || conversation.chatId}</strong><span>{conversation.account?.displayName ?? 'WhatsApp account'}</span></div>
              {conversation.messages.length ? conversation.messages.slice().reverse().map((message) => <div className="memory-message" key={message.id}><span>{message.senderType}</span><p>{message.content || `[${message.deliveryStatus}]`}</p><time>{new Date(message.createdAt).toLocaleString()}</time></div>) : <EmptyState>No messages saved for this conversation.</EmptyState>}
            </article>
          )) : <EmptyState>{loading ? 'Loading message history…' : 'No saved message history yet.'}</EmptyState>}
        </div>
      </section>
    );
  }

  if (page === 'Activity Logs') {
    return (
      <section className="page-stack">
        {pageHeading}
        {feedback}
        <div className="workspace-panel">
          {activity.length ? <div className="record-list">{activity.map((event) => <div className="record-row" key={event.id}><strong>{event.event}</strong><span>{event.resourceType ?? 'System'}{event.resourceId ? ` · ${event.resourceId}` : ''}</span><time>{new Date(event.createdAt).toLocaleString()}</time></div>)}</div> : <EmptyState>{loading ? 'Loading activity…' : 'No audit events have been recorded.'}</EmptyState>}
        </div>
      </section>
    );
  }

  if (page === 'Profile') {
    return (
      <section className="page-stack">
        {pageHeading}
        <article className="workspace-panel profile-grid">
          <div><span>Username</span><strong>{currentUser?.username ?? '—'}</strong></div>
          <div><span>Email</span><strong>{currentUser?.email ?? '—'}</strong></div>
          <div><span>Role</span><strong>{currentUser?.role ?? '—'}</strong></div>
          <div><span>WhatsApp accounts</span><strong>{accounts.length}</strong></div>
        </article>
      </section>
    );
  }

  if (page === 'Help & Documentation') {
    return (
      <section className="page-stack">
        {pageHeading}
        {feedback}
        <article className="workspace-panel">
          <div className="workspace-heading"><h2>System status</h2><span className={`status-tag ${health?.status === 'ready' ? 'positive' : ''}`}>{health?.status ?? 'Checking'}</span></div>
          <div className="record-list">
            <div className="record-row"><strong>PostgreSQL</strong><span>{health?.dependencies?.postgres ?? '—'}</span></div>
            <div className="record-row"><strong>Redis</strong><span>{health?.dependencies?.redis ?? '—'}</span></div>
          </div>
          <div className="quick-links">
            {['WhatsApp Accounts', 'AI Settings', 'Contacts'].map((item) => <button type="button" className="quick-link" key={item} onClick={() => onNavigate(item)}>{item}</button>)}
          </div>
        </article>
      </section>
    );
  }

  return <section className="page-stack">{pageHeading}<EmptyState>This section is unavailable.</EmptyState></section>;
}