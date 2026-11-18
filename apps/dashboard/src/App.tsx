import { Activity, Bot, ChevronRight, Database, LayoutGrid, LogOut, MessageSquareText, ShieldCheck, Trash2, UserRound, Wifi } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import WorkspacePages, { apiRequest } from './pages/WorkspacePages';

const stats = [
  { label: 'Connected Accounts', icon: Wifi },
  { label: 'Incoming Messages', icon: MessageSquareText },
  { label: 'AI Responses', icon: Bot },
  { label: 'System Health', icon: ShieldCheck },
];

const navItems = [
  'Overview',
  'WhatsApp Accounts',
  'Conversations',
  'AI Settings',
  'Bot Personality',
  'Automation',
  'Contacts',
  'Memory',
  'Activity Logs',
  'Profile',
  'Help & Documentation',
];

type Account = {
  id: string;
  displayName: string;
  phoneNumber?: string;
  connectionStatus: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING';
  qrCode?: string;
};

const API_URL = '';

export default function App() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const [currentUser, setCurrentUser] = useState<{ id: string; username: string; email: string; role: string } | null>(null);
  const [error, setError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activePage, setActivePage] = useState('Overview');
  const [overview, setOverview] = useState({
    connectedAccounts: 0,
    incomingMessages: 0,
    aiResponses: 0,
    dependencies: { postgres: 'checking', redis: 'checking' },
  });
  const [displayName, setDisplayName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [pairingPhoneNumber, setPairingPhoneNumber] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [statusType, setStatusType] = useState<'success' | 'error' | 'info'>('info');
  const [workingAction, setWorkingAction] = useState<string | null>(null);
  const [sendTo, setSendTo] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [sendMessage, setSendMessage] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  const request = apiRequest;

  const fetchAccounts = async () => {
    try {
      const data = await request('/api/v1/whatsapp/accounts');
      const nextAccounts: Account[] = data.accounts ?? [];
      setAccounts(nextAccounts);
      setSelectedAccountId((current) => nextAccounts.some((account) => account.id === current)
        ? current
        : nextAccounts[0]?.id ?? null);
      setStatusMessage('');
      setStatusType('info');
    } catch (fetchError) {
      setStatusType('error');
      setStatusMessage(fetchError instanceof Error ? fetchError.message : 'Unable to load accounts');
    }
  };

  const fetchOverview = async () => {
    try {
      const data = await request('/api/v1/dashboard/overview');
      setOverview(data);
    } catch (overviewError) {
      setStatusType('error');
      setStatusMessage(overviewError instanceof Error ? overviewError.message : 'Unable to load dashboard data');
    }
  };

  useEffect(() => {
    let active = true;
    void fetch(`${API_URL}/api/v1/auth/me`, {
      credentials: 'include',
    }).then(async (response) => {
      if (response.status === 401) return null;
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error ?? 'Unable to restore session');
      return data;
    }).then((data) => {
      if (!data) return;
      if (active) {
        setCurrentUser(data.user);
        setIsLoggedIn(true);
      }
    }).catch((sessionError) => {
      if (!active) return;
      setAuthNotice('Could not verify the session because the backend is unavailable. Start the server and try again.');
    }).finally(() => {
      if (active) setIsRestoringSession(false);
    });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      void fetchAccounts();
      void fetchOverview();
    }
  }, [isLoggedIn]);

  useEffect(() => {
    const pairingInProgress = accounts.some((account) =>
      account.connectionStatus === 'CONNECTING' || account.connectionStatus === 'RECONNECTING',
    );
    if (!isLoggedIn || !pairingInProgress) return;

    const intervalId = window.setInterval(() => void fetchAccounts(), 2500);
    return () => window.clearInterval(intervalId);
  }, [accounts, isLoggedIn]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const data = await request(
        isRegistering ? '/api/v1/auth/register' : '/api/v1/auth/login',
        'POST',
        isRegistering ? { username, email, password } : { usernameOrEmail: email, password },
      );
      setCurrentUser(data.user);
      setIsLoggedIn(true);
      setStatusType('success');
      setStatusMessage(isRegistering ? 'Account created successfully.' : 'Signed in successfully.');
      setError('');
      setPassword('');
      setIsRegistering(false);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Unable to sign in');
    } finally {
      setIsSubmitting(false);
    }
  };

  const logout = async () => {
    setIsLoggingOut(true);
    try {
      await request('/api/v1/auth/logout', 'POST');
      setAuthNotice('Signed out successfully.');
      setCurrentUser(null);
      setIsLoggedIn(false);
    } catch (logoutError) {
      setStatusType('error');
      setStatusMessage(logoutError instanceof Error ? logoutError.message : 'Unable to confirm session revocation.');
    } finally {
      setIsLoggingOut(false);
    }
  };

  const createAccount = async () => {
    setWorkingAction('create');
    try {
      const data = await request('/api/v1/whatsapp/accounts', 'POST', {
        displayName,
        phoneNumber,
      });
      setStatusMessage('WhatsApp account created.');
      setStatusType('success');
      setSelectedAccountId(data.account.id);
      await fetchAccounts();
    } catch (createError) {
      setStatusType('error');
      setStatusMessage(createError instanceof Error ? createError.message : 'Unable to create account');
    } finally {
      setWorkingAction(null);
    }
  };

  const loginAccount = async (accountId: string) => {
    setWorkingAction('login');
    try {
      const data = await request(`/api/v1/whatsapp/accounts/${accountId}/login`, 'POST', {});
      await fetchAccounts();
      setStatusMessage(`WhatsApp login activated for ${data.account.displayName}.`);
      setStatusType('success');
    } catch (loginError) {
      setStatusType('error');
      setStatusMessage(loginError instanceof Error ? loginError.message : 'Unable to log in');
    } finally {
      setWorkingAction(null);
    }
  };

  const refreshQr = async (accountId: string) => {
    setWorkingAction('qr');
    try {
      const data = await request(`/api/v1/whatsapp/accounts/${accountId}/qr/refresh`, 'POST', {});
      await fetchAccounts();
      setStatusMessage(`QR refreshed for ${data.account.displayName}.`);
      setStatusType('success');
    } catch (refreshError) {
      setStatusType('error');
      setStatusMessage(refreshError instanceof Error ? refreshError.message : 'Unable to refresh QR');
    } finally {
      setWorkingAction(null);
    }
  };

  const deleteAccount = async (accountId: string) => {
    const account = accounts.find((item) => item.id === accountId);
    if (!account || !window.confirm(`Permanently delete ${account.displayName}? This removes its saved WhatsApp login.`)) return;

    setWorkingAction('delete');
    try {
      await request(`/api/v1/whatsapp/accounts/${accountId}`, 'DELETE');
      await fetchAccounts();
      setStatusType('success');
      setStatusMessage(`${account.displayName} deleted.`);
    } catch (deleteError) {
      setStatusType('error');
      setStatusMessage(deleteError instanceof Error ? deleteError.message : 'Unable to delete account.');
    } finally {
      setWorkingAction(null);
    }
  };

  const disconnectAccount = async (accountId: string) => {
    setWorkingAction('disconnect');
    setPairingCode('');
    try {
      await request(`/api/v1/whatsapp/accounts/${accountId}/disconnect`, 'POST', {});
      await fetchAccounts();
      setStatusType('success');
      setStatusMessage('WhatsApp account disconnected.');
    } catch (disconnectError) {
      setStatusType('error');
      setStatusMessage(disconnectError instanceof Error ? disconnectError.message : 'Unable to disconnect account.');
    } finally {
      setWorkingAction(null);
    }
  };

  const requestPairingCode = async () => {
    if (!selectedAccountId) return;
    setWorkingAction('pair');
    setPairingCode('');
    try {
      const data = await request(`/api/v1/whatsapp/accounts/${selectedAccountId}/pairing-code`, 'POST', {
        phoneNumber: pairingPhoneNumber,
      });
      await fetchAccounts();
      setPairingPhoneNumber(data.account.phoneNumber ?? pairingPhoneNumber);
      setPairingCode(data.pairingCode);
      setStatusType('success');
      setStatusMessage('Pairing code ready. Enter it in WhatsApp Linked Devices.');
    } catch (pairingError) {
      setStatusType('error');
      setStatusMessage(pairingError instanceof Error ? pairingError.message : 'Unable to request a pairing code.');
    } finally {
      setWorkingAction(null);
    }
  };

  const sendOutboundMessage = async () => {
    if (!selectedAccountId) return;
    setWorkingAction('send');
    try {
      const data = await request(`/api/v1/whatsapp/accounts/${selectedAccountId}/send`, 'POST', {
        to: sendTo,
        content: sendMessage,
      });
      setStatusMessage(`Message sent to ${data.result.to}.`);
      setStatusType('success');
    } catch (sendError) {
      setStatusType('error');
      setStatusMessage(sendError instanceof Error ? sendError.message : 'Unable to send message');
    } finally {
      setWorkingAction(null);
    }
  };

  const generateAiDraft = async () => {
    if (!aiPrompt.trim()) {
      setStatusType('error');
      setStatusMessage('Enter a prompt to generate a WhatsApp draft.');
      return;
    }

    setWorkingAction('draft');
    try {
      const data = await request('/api/v1/ai/generate', 'POST', { prompt: aiPrompt });
      setSendMessage(data.response);
      setStatusType('success');
      setStatusMessage('AI draft ready. Review it before sending.');
    } catch (draftError) {
      setStatusType('error');
      setStatusMessage(draftError instanceof Error ? draftError.message : 'Unable to generate an AI draft.');
    } finally {
      setWorkingAction(null);
    }
  };

  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? null;

  useEffect(() => {
    setPairingPhoneNumber(selectedAccount?.phoneNumber ?? '');
    setPairingCode('');
  }, [selectedAccount?.id, selectedAccount?.phoneNumber]);

  if (isRestoringSession) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0f172a', color: '#e2e8f0' }}>Checking session...</div>;
  }

  if (!isLoggedIn) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0f172a', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ width: '100%', maxWidth: 420, background: '#111827', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 18, padding: 28, boxShadow: '0 20px 40px rgba(15,23,42,0.45)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: 'linear-gradient(135deg,#22c55e,#14b8a6)', display: 'grid', placeItems: 'center', fontWeight: 700, color: '#02130f' }}>S</div>
            <div>
              <div style={{ fontSize: 12, letterSpacing: '0.18em', color: '#94a3b8' }}>SURJO</div>
              <div style={{ fontWeight: 700, color: '#f8fafc' }}>WhatsApp AI</div>
            </div>
          </div>

          <h1 style={{ margin: '0 0 8px', color: '#f8fafc', fontSize: 28 }}>{isRegistering ? 'Create account' : 'Welcome back'}</h1>
          <p style={{ margin: '0 0 24px', color: '#94a3b8' }}>{isRegistering ? 'Register to manage your WhatsApp automation.' : 'Sign in to manage your WhatsApp automation.'}</p>

          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16 }}>
            {isRegistering ? (
              <label style={{ display: 'grid', gap: 8, color: '#e2e8f0', fontSize: 14 }}>
                Username
                <input
                  required
                  minLength={3}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  style={{ background: '#0f172a', border: '1px solid #334155', color: '#f8fafc', borderRadius: 10, padding: '12px 14px' }}
                  placeholder="Choose a username"
                />
              </label>
            ) : null}

            <label style={{ display: 'grid', gap: 8, color: '#e2e8f0', fontSize: 14 }}>
              {isRegistering ? 'Email' : 'Email or username'}
              <input
                required
                type={isRegistering ? 'email' : 'text'}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                style={{ background: '#0f172a', border: '1px solid #334155', color: '#f8fafc', borderRadius: 10, padding: '12px 14px' }}
                placeholder="you@example.com"
              />
            </label>

            <label style={{ display: 'grid', gap: 8, color: '#e2e8f0', fontSize: 14 }}>
              Password
              <input
                required
                type="password"
                minLength={12}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                style={{ background: '#0f172a', border: '1px solid #334155', color: '#f8fafc', borderRadius: 10, padding: '12px 14px' }}
                placeholder="At least 12 characters"
              />
            </label>

            {error ? <div role="alert" style={{ color: '#fca5a5', fontSize: 14 }}>{error}</div> : null}
            {authNotice ? <div role="status" aria-live="polite" style={{ color: '#cbd5e1', fontSize: 14 }}>{authNotice}</div> : null}

            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                background: 'linear-gradient(135deg,#22c55e,#14b8a6)',
                border: 'none',
                color: '#02130f',
                borderRadius: 10,
                padding: '12px 16px',
                fontWeight: 700,
                cursor: isSubmitting ? 'wait' : 'pointer',
              }}
            >
              {isSubmitting ? (isRegistering ? 'Creating account...' : 'Signing in...') : (isRegistering ? 'Create account' : 'Sign in')}
            </button>
          </form>
          <button type="button" onClick={() => { setIsRegistering(!isRegistering); setError(''); setAuthNotice(''); }} style={{ marginTop: 16, padding: 0, border: 0, background: 'transparent', color: '#86efac', cursor: 'pointer' }}>
            {isRegistering ? 'Already registered? Sign in' : 'Need an account? Register'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell" style={{ minHeight: '100vh', background: '#020817', color: '#e2e8f0' }}>
      <aside className="sidebar" style={{ background: '#0f172a', borderRight: '1px solid rgba(148,163,184,0.2)' }}>
        <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div className="brand-mark" style={{ width: 40, height: 40, background: 'linear-gradient(135deg,#22c55e,#14b8a6)', borderRadius: 12, display: 'grid', placeItems: 'center', fontWeight: 800, color: '#02130f' }}>S</div>
          <div>
            <div className="brand-name" style={{ fontSize: 12, letterSpacing: '0.18em', color: '#94a3b8' }}>SURJO</div>
            <div className="brand-subtitle" style={{ fontWeight: 700 }}>WHATSAPP AI</div>
          </div>
        </div>

        <nav className="nav" aria-label="Sidebar navigation" style={{ display: 'grid', gap: 8 }}>
          {navItems.map((item) => (
            <button key={item} className={`nav-item ${item === activePage ? 'active' : ''}`} type="button" aria-current={item === activePage ? 'page' : undefined} onClick={() => setActivePage(item)} style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#cbd5e1', background: item === activePage ? '#111827' : 'transparent', border: '1px solid transparent', borderRadius: 10, padding: '10px 12px', textAlign: 'left' }}>
              <LayoutGrid size={16} />
              <span>{item}</span>
              <ChevronRight size={14} />
            </button>
          ))}
        </nav>

        <div className="user-card" style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 12, background: '#111827', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 12, padding: 12 }}>
          <div className="avatar" style={{ width: 30, height: 30, borderRadius: 999, background: '#0f766e', display: 'grid', placeItems: 'center' }}>
            <UserRound size={18} />
          </div>
          <div>
            <strong>{currentUser?.username ?? 'Account'}</strong>
            <small style={{ display: 'block', color: '#94a3b8' }}>{currentUser?.email}</small>
          </div>
          <button type="button" onClick={logout} disabled={isLoggingOut} aria-label="Sign out" title="Sign out" style={{ marginLeft: 'auto', border: 0, background: 'transparent', color: '#cbd5e1', cursor: 'pointer' }}>
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow" style={{ margin: 0, color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.14em', fontSize: 12 }}>Operations</p>
            <h1 style={{ margin: '6px 0 0', fontSize: 32 }}>{activePage}</h1>
          </div>
          <button className="primary-button" type="button" onClick={() => setActivePage('WhatsApp Accounts')} style={{ background: '#22c55e', border: 'none', color: '#02130f', borderRadius: 10, padding: '10px 16px', fontWeight: 700 }}>Add Account</button>
        </header>

        {activePage === 'Overview' && <section className="stats-grid" style={{ display: 'grid', gap: 16, marginBottom: 20 }}>
          {stats.map(({ label, icon: Icon }) => {
            const values: Record<string, { value: string; detail: string }> = {
              'Connected Accounts': { value: String(overview.connectedAccounts), detail: 'from PostgreSQL' },
              'Incoming Messages': { value: String(overview.incomingMessages), detail: 'today, from PostgreSQL' },
              'AI Responses': { value: String(overview.aiResponses), detail: 'today, from PostgreSQL' },
              'System Health': {
                value: overview.dependencies.postgres === 'connected' && overview.dependencies.redis === 'connected' ? 'Ready' : 'Degraded',
                detail: 'PostgreSQL and Redis',
              },
            };
            const { value, detail } = values[label];
            return (
              <article key={label} className="stat-card" style={{ background: '#0f172a', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 16, padding: 16 }}>
                <div className="stat-header" style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: 12 }}>
                  <span>{label}</span>
                  <Icon size={18} />
                </div>
                <div className="stat-value" style={{ fontSize: 30, fontWeight: 700, margin: '12px 0 6px' }}>{value}</div>
                <div className="stat-detail" style={{ color: '#34d399', fontSize: 12 }}>{detail}</div>
              </article>
            );
          })}
        </section>}

        {activePage === 'Overview' && <WorkspacePages page={activePage} currentUser={currentUser} accounts={accounts} onNavigate={setActivePage} />}

        {activePage === 'WhatsApp Accounts' && <section className="accounts-grid">
          <article className="panel" style={{ background: '#0f172a', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 16, padding: 20 }}>
            <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ margin: 0 }}>Connect WhatsApp</h2>
              <a href="https://wa.me/settings/linked_devices" target="_blank" rel="noreferrer" className="ghost-button" style={{ border: '1px solid rgba(148,163,184,0.2)', background: 'transparent', color: '#cbd5e1', borderRadius: 8, padding: '6px 10px', textDecoration: 'none' }}>Linked Devices</a>
            </div>

            <div style={{ display: 'grid', gap: 12 }}>
              <label style={{ display: 'grid', gap: 8 }}>
                <span style={{ color: '#cbd5e1' }}>Display name</span>
                <input required minLength={2} maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} style={{ background: '#020817', border: '1px solid #334155', borderRadius: 10, padding: '10px 12px', color: 'white' }} />
              </label>

              <label style={{ display: 'grid', gap: 8 }}>
                <span style={{ color: '#cbd5e1' }}>Phone number</span>
                <input type="tel" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} style={{ background: '#020817', border: '1px solid #334155', borderRadius: 10, padding: '10px 12px', color: 'white' }} />
              </label>

              <button type="button" disabled={workingAction !== null || displayName.trim().length < 2} onClick={createAccount} style={{ background: 'linear-gradient(135deg,#22c55e,#14b8a6)', border: 'none', borderRadius: 10, padding: '12px 16px', fontWeight: 700, color: '#02130f' }}>{workingAction === 'create' ? 'Creating account...' : 'Create WhatsApp account'}</button>
            </div>

            {statusMessage ? <div role="status" aria-live="polite" style={{ marginTop: 16, color: statusType === 'error' ? '#fca5a5' : statusType === 'success' ? '#86efac' : '#cbd5e1', fontSize: 14 }}>{statusMessage}</div> : null}
          </article>

          <article className="panel" style={{ background: '#0f172a', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 16, padding: 20 }}>
            <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Web WhatsApp login</h2>
              <span className="status-pill" style={{ background: selectedAccount?.connectionStatus === 'CONNECTED' ? '#052e16' : '#422006', color: selectedAccount?.connectionStatus === 'CONNECTED' ? '#86efac' : '#fcd34d', borderRadius: 999, padding: '4px 10px', fontSize: 12 }}>{selectedAccount?.connectionStatus ?? 'No account'}</span>
            </div>

            <div style={{ display: 'grid', gap: 16 }}>
              {selectedAccount ? (
                <>
                  {accounts.length > 1 ? (
                    <label style={{ display: 'grid', gap: 8 }}>
                      <span style={{ color: '#cbd5e1' }}>WhatsApp account</span>
                      <select value={selectedAccount.id} onChange={(event) => setSelectedAccountId(event.target.value)} style={{ background: '#020817', border: '1px solid #334155', borderRadius: 10, padding: '10px 12px', color: 'white' }}>
                        {accounts.map((account) => <option value={account.id} key={account.id}>{account.displayName} · {account.connectionStatus}</option>)}
                      </select>
                    </label>
                  ) : null}
                  <div style={{ background: '#020817', border: '1px dashed rgba(34,197,94,0.4)', borderRadius: 12, padding: 12 }}>
                    <div style={{ color: '#94a3b8', marginBottom: 8 }}>Account</div>
                    <div style={{ fontWeight: 700 }}>{selectedAccount.displayName}</div>
                    <div style={{ color: '#cbd5e1' }}>{selectedAccount.phoneNumber ?? 'No phone'}</div>
                    <div style={{ marginTop: 8, color: selectedAccount.connectionStatus === 'CONNECTED' ? '#86efac' : '#fbbf24' }}>{selectedAccount.connectionStatus}</div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" disabled={workingAction !== null} onClick={() => loginAccount(selectedAccount.id)} style={{ background: '#1d4ed8', color: 'white', border: 'none', borderRadius: 10, padding: '10px 12px' }}>{workingAction === 'login' ? 'Connecting...' : 'Connect with QR'}</button>
                    <button type="button" disabled={workingAction !== null} onClick={() => refreshQr(selectedAccount.id)} style={{ background: '#0f172a', color: '#e2e8f0', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 10, padding: '10px 12px' }}>{workingAction === 'qr' ? 'Refreshing...' : 'Refresh QR'}</button>
                    <button type="button" disabled={workingAction !== null || selectedAccount.connectionStatus !== 'CONNECTED'} onClick={() => disconnectAccount(selectedAccount.id)} style={{ background: '#0f172a', color: '#e2e8f0', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 10, padding: '10px 12px' }}>{workingAction === 'disconnect' ? 'Disconnecting...' : 'Disconnect'}</button>
                    <button type="button" disabled={workingAction !== null} onClick={() => deleteAccount(selectedAccount.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#7f1d1d', color: 'white', border: 'none', borderRadius: 10, padding: '10px 12px' }}><Trash2 size={16} />{workingAction === 'delete' ? 'Deleting...' : 'Delete account'}</button>
                  </div>

                  <label style={{ display: 'grid', gap: 8 }}>
                    <span style={{ color: '#cbd5e1' }}>Phone number with country code</span>
                    <input type="tel" inputMode="tel" autoComplete="tel" value={pairingPhoneNumber} onChange={(event) => { setPairingPhoneNumber(event.target.value); setPairingCode(''); }} placeholder="15551234567" style={{ background: '#020817', border: '1px solid #334155', borderRadius: 10, padding: '10px 12px', color: 'white' }} />
                  </label>
                  <button type="button" disabled={workingAction !== null || pairingPhoneNumber.replace(/\D/g, '').length < 7} onClick={requestPairingCode} style={{ background: '#0f172a', color: '#e2e8f0', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 10, padding: '10px 12px' }}>{workingAction === 'pair' ? 'Requesting code...' : 'Connect with phone number'}</button>
                  {pairingCode ? <div role="status" aria-live="polite" style={{ background: '#020817', border: '1px solid rgba(34,197,94,0.4)', borderRadius: 12, padding: 12, textAlign: 'center' }}><div style={{ color: '#94a3b8', marginBottom: 8 }}>WhatsApp pairing code</div><strong style={{ fontSize: 24, letterSpacing: '0.12em' }}>{pairingCode}</strong><p style={{ color: '#cbd5e1', marginBottom: 0 }}>In WhatsApp, open Linked Devices, choose “Link with phone number,” then enter this code.</p></div> : null}

                  {selectedAccount.qrCode ? (
                    <div style={{ background: '#020817', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 12, padding: 12 }}>
                      <div style={{ marginBottom: 8, color: '#94a3b8' }}>WhatsApp pairing QR</div>
                      {selectedAccount.qrCode.startsWith('data:image') ? (
                        <img src={selectedAccount.qrCode} alt="WhatsApp QR code" style={{ display: 'block', width: 220, maxWidth: '100%', borderRadius: 12, background: '#f8fafc', padding: 8, margin: '0 auto' }} />
                      ) : (
                        <div style={{ fontFamily: 'monospace', wordBreak: 'break-all', color: '#e2e8f0' }}>{selectedAccount.qrCode}</div>
                      )}
                    </div>
                  ) : null}
                </>
              ) : (
                <div style={{ color: '#94a3b8' }}>No active WhatsApp account yet.</div>
              )}
            </div>
          </article>
        </section>}

        {activePage === 'WhatsApp Accounts' && <section className="message-grid">
          <article className="panel" style={{ background: '#0f172a', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 16, padding: 20 }}>
            <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ margin: 0 }}>Send message</h2>
              <span className="status-pill" style={{ background: '#422006', color: '#fcd34d', borderRadius: 999, padding: '4px 10px', fontSize: 12 }}>Manual</span>
            </div>

            <div style={{ display: 'grid', gap: 12 }}>
              <label style={{ display: 'grid', gap: 8 }}>
                <span style={{ color: '#cbd5e1' }}>Send to</span>
                <input value={sendTo} onChange={(event) => setSendTo(event.target.value)} style={{ background: '#020817', border: '1px solid #334155', borderRadius: 10, padding: '10px 12px', color: 'white' }} />
              </label>

              <label style={{ display: 'grid', gap: 8 }}>
                <span style={{ color: '#cbd5e1' }}>OmniRoute prompt</span>
                <textarea value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} rows={3} placeholder="Describe the reply you want drafted" style={{ background: '#020817', border: '1px solid #334155', borderRadius: 10, padding: '10px 12px', color: 'white', resize: 'vertical' }} />
              </label>

              <button type="button" disabled={workingAction !== null} onClick={generateAiDraft} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: '#15803d', border: 'none', borderRadius: 10, padding: '10px 12px', color: 'white' }}>
                <Bot size={16} />{workingAction === 'draft' ? 'Generating draft...' : 'Draft with OmniRoute'}
              </button>

              <label style={{ display: 'grid', gap: 8 }}>
                <span style={{ color: '#cbd5e1' }}>Message</span>
                <textarea value={sendMessage} onChange={(event) => setSendMessage(event.target.value)} rows={4} style={{ background: '#020817', border: '1px solid #334155', borderRadius: 10, padding: '10px 12px', color: 'white', resize: 'vertical' }} />
              </label>

              <button type="button" disabled={workingAction !== null || !selectedAccountId || !sendTo.trim() || !sendMessage.trim()} onClick={sendOutboundMessage} style={{ background: 'linear-gradient(135deg,#0ea5e9,#2563eb)', border: 'none', borderRadius: 10, padding: '12px 16px', fontWeight: 700, color: 'white' }}>{workingAction === 'send' ? 'Sending...' : 'Send WhatsApp message'}</button>
            </div>
          </article>

          <article className="panel" style={{ background: '#0f172a', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 16, padding: 20 }}>
            <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ margin: 0 }}>Activity</h2>
            </div>

            <div style={{ color: '#94a3b8' }}>No activity has been recorded yet.</div>
          </article>
        </section>}

        {activePage !== 'Overview' && activePage !== 'WhatsApp Accounts' && <WorkspacePages page={activePage} currentUser={currentUser} accounts={accounts} onNavigate={setActivePage} />}
      </main>
    </div>
  );
}
