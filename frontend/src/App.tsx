import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AlertCircle, Bot, ChevronLeft, Database, LayoutDashboard, LogOut, Plug, Plus, Save, Search, Send, Settings, UserRound, Users } from "lucide-react";
import { api, currentUser, login, logout, type User } from "./lib/api";

type Page = "dashboard" | "finder" | "candidates" | "candidate" | "ai" | "integrations" | "settings";

type Candidate = {
  id: string;
  fullName: string;
  email: string[];
  phone: string[];
  city?: string;
  country?: string;
  linkedinUrl?: string;
  currentRole?: string;
  seniority?: string;
  years?: number;
  tags: string[];
  languages: { lang: string; level: string }[];
  summary?: string;
  strengths: string[];
  weaknesses: string[];
  qualityScore: number;
  sourceCount: number;
  status: string;
};

const nav = [
  ["dashboard", LayoutDashboard, "Dashboard"],
  ["finder", Search, "Talent Finder"],
  ["candidates", Users, "Candidatos"],
  ["ai", Bot, "AGLH AI"],
  ["integrations", Plug, "Integraciones"],
  ["settings", Settings, "Configuración"]
] as const;

export function App() {
  const [user, setUser] = useState<User | null>(currentUser());
  const [page, setPage] = useState<Page>("dashboard");
  const [candidateId, setCandidateId] = useState<string | null>(null);

  if (!user) return <Login onLogin={setUser} />;

  const openCandidate = (id: string) => {
    setCandidateId(id);
    setPage("candidate");
  };

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 w-56 bg-navy text-white">
        <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-teal font-extrabold">TH</div>
          <div>
            <div className="text-sm font-bold">Talent Hub</div>
            <div className="text-xs text-white/50">AGLH</div>
          </div>
        </div>
        <nav className="p-3">
          {nav.map(([key, Icon, label]) => (
            <button key={key} onClick={() => setPage(key)} className={`mb-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm ${page === key || (page === "candidate" && key === "candidates") ? "bg-white/10 text-white" : "text-white/65 hover:bg-white/5"}`}>
              <Icon size={17} /> {label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="ml-56 flex min-h-screen flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6">
          <div className="flex items-center gap-3">
            {page === "candidate" && <button className="btn-ghost" onClick={() => setPage("candidates")}><ChevronLeft size={16} /> Candidatos</button>}
            <h1 className="text-lg font-bold">{titleFor(page)}</h1>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500">{user.name} · {user.role}</span>
            <button className="btn-ghost" onClick={() => { logout(); setUser(null); }}><LogOut size={16} /></button>
          </div>
        </header>
        {page === "dashboard" && <Dashboard />}
        {page === "finder" && <TalentFinder onView={openCandidate} />}
        {page === "candidates" && <Candidates onView={openCandidate} />}
        {page === "candidate" && candidateId && <CandidateProfile id={candidateId} canEdit={user.role !== "viewer"} />}
        {page === "ai" && <Chat onView={openCandidate} />}
        {page === "integrations" && <Integrations canEdit={user.role === "admin"} />}
        {page === "settings" && <SettingsPage canEdit={user.role === "admin"} />}
      </main>
    </div>
  );
}

function titleFor(page: Page) {
  return ({ dashboard: "Dashboard", finder: "Talent Finder", candidates: "Candidatos", candidate: "Ficha de candidato", ai: "AGLH AI", integrations: "Integraciones", settings: "Configuración" } as Record<Page, string>)[page];
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try { onLogin(await login(email, password)); } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  }
  return (
    <div className="grid min-h-screen place-items-center bg-canvas p-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-navy font-extrabold text-white">TH</div>
          <div><h1 className="font-bold">Talent Hub AGLH</h1><p className="text-sm text-slate-500">Ingreso seguro</p></div>
        </div>
        {error && <ErrorBox message={error} />}
        <label className="label">Email</label>
        <input className="field mb-3" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label className="label">Contraseña</label>
        <input className="field mb-5" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button className="btn-primary w-full" disabled={loading}>{loading ? "Ingresando..." : "Ingresar"}</button>
      </form>
    </div>
  );
}

function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => { api<any>("/dashboard").then(setData).catch((e) => setError(e.message)); }, []);
  if (error) return <PagePad><ErrorBox message={error} /></PagePad>;
  if (!data) return <PagePad><Skeleton /></PagePad>;
  const metrics = [
    ["Total candidatos", data.metrics.totalCandidates],
    ["Nuevos esta semana", data.metrics.newThisWeek],
    ["Procesos activos", data.metrics.activeProcesses],
    ["Fuentes conectadas", data.metrics.connectedSources]
  ];
  return (
    <PagePad>
      <div className="mb-6 grid gap-4 md:grid-cols-4">{metrics.map(([label, value]) => <div className="card p-5" key={label}><div className="text-sm text-slate-500">{label}</div><div className="mt-2 text-3xl font-extrabold">{value}</div></div>)}</div>
      <Table title="Sincronizaciones recientes" rows={data.syncLogs} empty="Todavía no hay sincronizaciones registradas." columns={["source", "status", "new_records", "updated_records", "errors"]} />
    </PagePad>
  );
}

function Candidates({ onView }: { onView: (id: string) => void }) {
  const [items, setItems] = useState<Candidate[]>([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const load = () => api<{ data: Candidate[] }>(`/candidates?search=${encodeURIComponent(search)}`).then((r) => setItems(r.data));
  useEffect(() => { load(); }, []);
  return (
    <PagePad>
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="field max-w-md" placeholder="Buscar por nombre, rol o tag" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
        <button className="btn-ghost" onClick={load}><Search size={16} /> Buscar</button>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}><Plus size={16} /> Nuevo candidato</button>
      </div>
      {showForm && <CandidateForm onSaved={() => { setShowForm(false); load(); }} />}
      <div className="grid gap-3">
        {items.length === 0 && <Empty text="No hay candidatos cargados. Creá el primero o conectá una integración real." />}
        {items.map((c) => <CandidateRow key={c.id} candidate={c} onView={onView} />)}
      </div>
    </PagePad>
  );
}

function CandidateForm({ onSaved }: { onSaved: () => void }) {
  const [form, setForm] = useState({ fullName: "", currentRole: "", city: "", country: "", email: "", phone: "", seniority: "", years: 0, tags: "", summary: "", qualityScore: 0 });
  const [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/candidates", { method: "POST", body: JSON.stringify({ ...form, email: list(form.email), phone: list(form.phone), tags: list(form.tags), years: Number(form.years), qualityScore: Number(form.qualityScore) }) });
      onSaved();
    } catch (err: any) { setError(err.message); }
  }
  return (
    <form onSubmit={save} className="card mb-4 grid gap-3 p-4 md:grid-cols-2">
      {error && <div className="md:col-span-2"><ErrorBox message={error} /></div>}
      <Input label="Nombre completo" value={form.fullName} onChange={(v) => setForm({ ...form, fullName: v })} required />
      <Input label="Rol actual" value={form.currentRole} onChange={(v) => setForm({ ...form, currentRole: v })} />
      <Input label="Ciudad" value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
      <Input label="País" value={form.country} onChange={(v) => setForm({ ...form, country: v })} />
      <Input label="Emails separados por coma" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
      <Input label="Teléfonos separados por coma" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
      <Input label="Seniority" value={form.seniority} onChange={(v) => setForm({ ...form, seniority: v })} />
      <Input label="Años" type="number" value={String(form.years)} onChange={(v) => setForm({ ...form, years: Number(v) })} />
      <Input label="Tags separados por coma" value={form.tags} onChange={(v) => setForm({ ...form, tags: v })} />
      <Input label="Calidad 0-100" type="number" value={String(form.qualityScore)} onChange={(v) => setForm({ ...form, qualityScore: Number(v) })} />
      <div className="md:col-span-2"><label className="label">Resumen</label><textarea className="field" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></div>
      <button className="btn-primary md:col-span-2"><Save size={16} /> Guardar candidato</button>
    </form>
  );
}

function TalentFinder({ onView }: { onView: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [seniority, setSeniority] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  async function run() {
    if (!query.trim()) return;
    setLoading(true);
    const response = await api<{ data: any[] }>("/search/talent", { method: "POST", body: JSON.stringify({ query, filters: { seniority: seniority || undefined, activeOnly } }) });
    setResults(response.data);
    setLoading(false);
  }
  return (
    <PagePad>
      <textarea className="field min-h-36" placeholder="Pegá o escribí la descripción del cargo..." value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="my-3 flex flex-wrap items-center gap-3">
        <select className="field max-w-48" value={seniority} onChange={(e) => setSeniority(e.target.value)}><option value="">Todo seniority</option><option>Junior</option><option>Semi-Senior</option><option>Senior</option><option>Lead</option><option>Manager</option></select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> Solo activos</label>
        <button className="btn-primary" onClick={run} disabled={!query.trim() || loading}><Search size={16} /> {loading ? "Buscando..." : "Buscar candidatos"}</button>
      </div>
      <div className="mb-3 text-sm text-slate-500">{results.length} candidatos encontrados · ordenados por compatibilidad</div>
      <div className="grid gap-3">{results.length === 0 && <Empty text="La búsqueda todavía no devolvió candidatos reales." />}{results.map((c) => <CandidateRow key={c.id} candidate={{ ...c, qualityScore: c.score, sourceCount: 0, email: [], phone: [], languages: [], strengths: [], weaknesses: [], status: "active" }} onView={onView} reason={c.matchReason} />)}</div>
    </PagePad>
  );
}

function CandidateProfile({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState("resumen");
  const [error, setError] = useState("");
  const load = () => api<any>(`/candidates/${id}`).then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [id]);
  if (error) return <PagePad><ErrorBox message={error} /></PagePad>;
  if (!data) return <PagePad><Skeleton /></PagePad>;
  const c: Candidate = data.data;
  return (
    <PagePad>
      <section className="card mb-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex gap-4"><Avatar name={c.fullName} /><div><h2 className="text-2xl font-extrabold">{c.fullName}</h2><p className="text-slate-500">{c.currentRole || "Sin rol actual"} · {[c.city, c.country].filter(Boolean).join(", ")}</p><TagList tags={c.tags} /></div></div>
          <Score score={c.qualityScore} />
        </div>
      </section>
      <div className="mb-4 flex flex-wrap gap-2">{["resumen", "experiencia", "formacion", "documentos", "procesos", "ia"].map((t) => <button key={t} onClick={() => setTab(t)} className={tab === t ? "btn-primary" : "btn-ghost"}>{t}</button>)}</div>
      {tab === "resumen" && <div className="grid gap-4 md:grid-cols-2"><InfoCard title="Resumen IA" text={c.summary || "Sin resumen registrado."} /><InfoCard title="Contacto" text={[...c.email, ...c.phone, c.linkedinUrl].filter(Boolean).join("\n") || "Sin datos de contacto."} /><InfoCard title="Idiomas" text={c.languages?.map((l) => `${l.lang}: ${l.level}`).join("\n") || "Sin idiomas registrados."} /></div>}
      {tab === "experiencia" && <ChildList rows={data.work} empty="Sin experiencia registrada." fields={["company", "position", "start_date", "end_date", "description"]} canEdit={canEdit} kind="work" id={id} onSaved={load} />}
      {tab === "formacion" && <ChildList rows={data.education} empty="Sin formación registrada." fields={["institution", "degree", "field", "start_year", "end_year"]} canEdit={canEdit} kind="education" id={id} onSaved={load} />}
      {tab === "documentos" && <ChildList rows={data.documents} empty="Sin documentos registrados." fields={["type", "file_name", "source_type", "created_at"]} canEdit={canEdit} kind="documents" id={id} onSaved={load} />}
      {tab === "procesos" && <ChildList rows={data.processes} empty="Sin procesos registrados." fields={["process_name", "client", "stage", "event_date"]} canEdit={canEdit} kind="processes" id={id} onSaved={load} />}
      {tab === "ia" && <div className="grid gap-4 md:grid-cols-3"><InfoCard title="Fortalezas" text={c.strengths?.join("\n") || "Sin fortalezas registradas."} /><InfoCard title="Áreas de oportunidad" text={c.weaknesses?.join("\n") || "Sin áreas registradas."} /><InfoCard title="Seniority" text={`${c.seniority || "Sin estimación"} ${c.years ? `· ${c.years} años` : ""}`} /></div>}
    </PagePad>
  );
}

function ChildList({ rows, empty, fields, canEdit, kind, id, onSaved }: any) {
  const [open, setOpen] = useState(false);
  return <div className="grid gap-3">{canEdit && <button className="btn-primary w-fit" onClick={() => setOpen(!open)}><Plus size={16} /> Agregar</button>}{open && <ChildForm kind={kind} id={id} onSaved={() => { setOpen(false); onSaved(); }} />}{rows.length === 0 && <Empty text={empty} />}{rows.map((row: any) => <div className="card p-4" key={row.id}>{fields.map((f: string) => <div key={f} className="text-sm"><span className="font-semibold text-slate-500">{f}: </span>{String(row[f] ?? "")}</div>)}</div>)}</div>;
}

function ChildForm({ kind, id, onSaved }: any) {
  const shapes: Record<string, string[]> = { work: ["company", "position", "startDate", "endDate", "description"], education: ["institution", "degree", "field", "startYear", "endYear"], documents: ["type", "fileName", "fileUrl", "sourceType"], processes: ["processName", "client", "stage", "eventDate", "notes"] };
  const [form, setForm] = useState<Record<string, string>>({});
  async function save(e: FormEvent) {
    e.preventDefault();
    const payload = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, ["startYear", "endYear"].includes(k) ? Number(v) : v]));
    await api(`/candidates/${id}/${kind}`, { method: "POST", body: JSON.stringify(payload) });
    onSaved();
  }
  return <form onSubmit={save} className="card grid gap-3 p-4 md:grid-cols-2">{shapes[kind].map((f) => <Input key={f} label={f} value={form[f] ?? ""} onChange={(v) => setForm({ ...form, [f]: v })} required={["company", "position", "institution", "type", "fileName", "processName", "client", "stage"].includes(f)} />)}<button className="btn-primary md:col-span-2">Guardar</button></form>;
}

function Chat({ onView }: { onView: (id: string) => void }) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [session, setSession] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [candidates, setCandidates] = useState<any[]>([]);
  const loadSessions = () => api<{ data: any[] }>("/chat/sessions").then((r) => { setSessions(r.data); if (!session && r.data[0]) setSession(r.data[0].id); });
  useEffect(() => { loadSessions(); }, []);
  useEffect(() => { if (session) api<{ data: any[] }>(`/chat/sessions/${session}/messages`).then((r) => setMessages(r.data)); }, [session]);
  async function newSession() { const r = await api<{ data: any }>("/chat/sessions", { method: "POST", body: JSON.stringify({ title: "Nueva conversación" }) }); setSession(r.data.id); loadSessions(); }
  async function send() {
    if (!session || !input.trim()) return;
    const text = input; setInput("");
    const r = await api<any>(`/chat/sessions/${session}/messages`, { method: "POST", body: JSON.stringify({ content: text }) });
    setCandidates(r.candidates ?? []);
    const m = await api<{ data: any[] }>(`/chat/sessions/${session}/messages`);
    setMessages(m.data);
    loadSessions();
  }
  return <div className="flex flex-1 overflow-hidden"><aside className="w-72 border-r border-slate-200 bg-white p-4"><button className="btn-primary mb-4 w-full" onClick={newSession}><Plus size={16} /> Nueva conversación</button>{sessions.map((s) => <button key={s.id} onClick={() => setSession(s.id)} className={`mb-1 block w-full rounded-md px-3 py-2 text-left text-sm ${session === s.id ? "bg-teal/10 text-teal" : "hover:bg-slate-50"}`}>{s.title}</button>)}</aside><section className="flex flex-1 flex-col"><div className="flex-1 space-y-3 overflow-auto p-6">{messages.length === 0 && <Empty text="Abrí una conversación y consultá sobre candidatos reales." />}{messages.map((m) => <div key={m.id} className={`max-w-2xl rounded-lg p-3 text-sm ${m.role === "user" ? "ml-auto bg-teal text-white" : "bg-white border border-slate-200"}`}>{m.content}</div>)}{candidates.map((c) => <CandidateRow key={c.id} candidate={{ ...c, qualityScore: c.score, sourceCount: 0, email: [], phone: [], languages: [], strengths: [], weaknesses: [], status: "active" }} onView={onView} />)}</div><div className="border-t border-slate-200 bg-white p-4"><div className="flex gap-2"><textarea className="field min-h-12" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} /><button className="btn-primary" onClick={send}><Send size={16} /></button></div></div></section></div>;
}

function Integrations({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = useState<any>({ data: [], logs: [] });
  const [editing, setEditing] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkError, setBulkError] = useState("");
  const load = () => api<any>("/integrations").then(setData);
  useEffect(() => { load(); }, []);
  async function save(id: string, status: string) { await api(`/integrations/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }); load(); }
  async function sync(id: string) { await api(`/integrations/${id}/sync`, { method: "POST" }); load(); }
  async function applyBulk(e: FormEvent) {
    e.preventDefault();
    setBulkError("");
    try {
      const parsed = JSON.parse(bulkText);
      for (const [id, config] of Object.entries(parsed)) {
        await api(`/integrations/${id}`, { method: "PATCH", body: JSON.stringify({ status: "connected", config }) });
      }
      setBulkText("");
      setBulkOpen(false);
      load();
    } catch (err: any) {
      setBulkError(err.message || "JSON inválido");
    }
  }
  const template = `{
  "yoiners": { "username": "", "password": "" },
  "aglh": { "username": "", "password": "" },
  "gmail": { "username": "", "password": "" },
  "buscojobs": { "username": "", "password": "" }
}`;
  return <PagePad><div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Pegá sesiones/API keys solo de cuentas propias y fuentes donde tengas permiso de extracción. Los valores sensibles se guardan en el backend y luego se muestran ocultos.</div>{canEdit && <div className="card mb-4 p-4"><button className="btn-primary" onClick={() => { setBulkOpen(!bulkOpen); if (!bulkText) setBulkText(template); }}><Settings size={16} /> Cargar todas las cuentas</button>{bulkOpen && <form onSubmit={applyBulk} className="mt-4 grid gap-3">{bulkError && <ErrorBox message={bulkError} />}<textarea className="field min-h-52 font-mono text-xs" value={bulkText} onChange={(e) => setBulkText(e.target.value)} /><button className="btn-primary w-fit"><Save size={16} /> Guardar todas</button></form>}</div>}<div className="mb-6 grid gap-4 md:grid-cols-2">{data.data.map((i: any) => <div className="card p-4" key={i.id}><div className="mb-2 flex items-center justify-between"><div className="font-bold">{i.name}</div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{i.status}</span></div><p className="text-sm text-slate-500">Última sync: {i.last_sync_at ? new Date(i.last_sync_at).toLocaleString() : "Nunca"} · {i.total_imported} registros</p><div className="mt-3 flex flex-wrap gap-2">{canEdit && <select className="field max-w-44" value={i.status} onChange={(e) => save(i.id, e.target.value)}><option value="not_configured">No configurado</option><option value="connected">Conectado</option><option value="warning">Advertencia</option><option value="error">Error</option><option value="soon">Próximamente</option></select>}{canEdit && <button className="btn-ghost" onClick={() => setEditing(editing === i.id ? null : i.id)}><Settings size={16} /> Configurar</button>}<button className="btn-primary" onClick={() => sync(i.id)}>Sincronizar</button></div>{editing === i.id && <IntegrationConfigPanelV2 integration={i} onSaved={() => { setEditing(null); load(); }} />}</div>)}</div><Table title="Log de sincronizaciones" rows={data.logs} empty="Sin logs registrados." columns={["source", "status", "new_records", "updated_records", "errors", "message"]} /></PagePad>;
}

function IntegrationConfigPanelV2({ integration, onSaved }: { integration: any; onSaved: () => void }) {
  const [form, setForm] = useState({
    baseUrl: integration.config?.baseUrl === "********" ? "" : integration.config?.baseUrl ?? "",
    apiKey: "",
    username: integration.config?.username === "********" ? "" : integration.config?.username ?? "",
    password: "",
    sessionCookies: "",
    historicalData: "",
    notes: integration.config?.notes === "********" ? "" : integration.config?.notes ?? ""
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function saveConfig(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const config = Object.fromEntries(Object.entries(form).filter(([, value]) => String(value).trim().length > 0));
    try {
      await api(`/integrations/${integration.id}`, { method: "PATCH", body: JSON.stringify({ status: "connected", config }) });
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }
  async function loadHistoricalFile(file?: File) {
    if (!file) return;
    const text = await file.text();
    setForm((current) => ({ ...current, historicalData: text }));
  }
  return <form onSubmit={saveConfig} className="mt-4 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4">{error && <ErrorBox message={error} />}<div className="grid gap-3 md:grid-cols-2"><Input label="URL o endpoint" value={form.baseUrl} onChange={(v) => setForm({ ...form, baseUrl: v })} /><Input label="Usuario/email" value={form.username} onChange={(v) => setForm({ ...form, username: v })} /><Input label="API key/token" type="password" value={form.apiKey} onChange={(v) => setForm({ ...form, apiKey: v })} /><Input label="Contrasena" type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} /></div><div><label className="label">Sesion/cookies exportadas</label><textarea className="field min-h-24" placeholder="Opcional. Dejalo vacio si no sabes que es." value={form.sessionCookies} onChange={(e) => setForm({ ...form, sessionCookies: e.target.value })} /></div><div><label className="label">Archivo historico exportado</label><input className="field" type="file" accept=".csv,.txt,.json" onChange={(e) => loadHistoricalFile(e.target.files?.[0])} /><p className="mt-1 text-xs text-slate-500">Usa el boton Exportar datos de Buscojobs y carga aca el archivo descargado.</p></div><div><label className="label">Datos historicos JSON/CSV</label><textarea className="field min-h-40 font-mono text-xs" placeholder={`Pega aca un exportado de candidatos. Ejemplo CSV:\nnombre,email,telefono,cargo,ciudad\nAna Perez,ana@mail.com,099123456,Analista,Montevideo`} value={form.historicalData} onChange={(e) => setForm({ ...form, historicalData: e.target.value })} /></div><div><label className="label">Notas internas</label><textarea className="field min-h-20" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div><button className="btn-primary w-fit" disabled={saving}><Save size={16} /> {saving ? "Guardando..." : "Guardar configuracion"}</button></form>;
}

function IntegrationConfigPanel({ integration, onSaved }: { integration: any; onSaved: () => void }) {
  const [form, setForm] = useState({
    baseUrl: integration.config?.baseUrl === "••••••••" ? "" : integration.config?.baseUrl ?? "",
    apiKey: "",
    username: integration.config?.username === "••••••••" ? "" : integration.config?.username ?? "",
    password: "",
    sessionCookies: "",
    notes: integration.config?.notes === "••••••••" ? "" : integration.config?.notes ?? ""
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function saveConfig(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const config = Object.fromEntries(Object.entries(form).filter(([, value]) => String(value).trim().length > 0));
    try {
      await api(`/integrations/${integration.id}`, { method: "PATCH", body: JSON.stringify({ status: "connected", config }) });
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }
  return <form onSubmit={saveConfig} className="mt-4 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4">{error && <ErrorBox message={error} />}<div className="grid gap-3 md:grid-cols-2"><Input label="URL o endpoint" value={form.baseUrl} onChange={(v) => setForm({ ...form, baseUrl: v })} /><Input label="Usuario/email" value={form.username} onChange={(v) => setForm({ ...form, username: v })} /><Input label="API key/token" type="password" value={form.apiKey} onChange={(v) => setForm({ ...form, apiKey: v })} /><Input label="Contraseña" type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} /></div><div><label className="label">Sesión/cookies exportadas</label><textarea className="field min-h-28" placeholder="Pegá acá cookies JSON o header Cookie de tu cuenta, si esa fuente lo permite." value={form.sessionCookies} onChange={(e) => setForm({ ...form, sessionCookies: e.target.value })} /></div><div><label className="label">Notas internas</label><textarea className="field min-h-20" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div><button className="btn-primary w-fit" disabled={saving}><Save size={16} /> {saving ? "Guardando..." : "Guardar configuración"}</button></form>;
}

function SettingsPage({ canEdit }: { canEdit: boolean }) {
  const [settings, setSettings] = useState<any>({});
  const load = () => api<any>("/settings").then((r) => setSettings(r.data));
  useEffect(() => { load(); }, []);
  async function save(key: string) { await api(`/settings/${key}`, { method: "PATCH", body: JSON.stringify({ value: settings[key] }) }); load(); }
  return <PagePad><div className="grid gap-4">{Object.entries(settings).map(([key, value]: any) => <div className="card p-4" key={key}><h2 className="mb-3 font-bold capitalize">{key}</h2><div className="grid gap-3 md:grid-cols-3">{Object.entries(value).map(([field, val]: any) => <Input key={field} label={field} value={String(val ?? "")} disabled={!canEdit} onChange={(v) => setSettings({ ...settings, [key]: { ...settings[key], [field]: v } })} />)}</div>{canEdit && <button className="btn-primary mt-3" onClick={() => save(key)}><Save size={16} /> Guardar</button>}</div>)}</div></PagePad>;
}

function shortText(value: string | undefined | null, max = 110) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function CandidateRow({ candidate, onView, reason }: { candidate: Candidate; onView: (id: string) => void; reason?: string }) {
  const role = shortText(candidate.currentRole || "Sin rol", 90);
  const location = shortText(candidate.city || candidate.country || "Sin ciudad", 45);
  return <div className="card flex flex-wrap items-center justify-between gap-4 p-4"><div className="flex min-w-0 flex-1 gap-3"><Avatar name={candidate.fullName} small /><div className="min-w-0 flex-1"><div className="truncate font-bold">{shortText(candidate.fullName, 90)}</div><div className="truncate text-sm text-slate-500">{role} · {location} · {candidate.years ?? 0} años</div><TagList tags={candidate.tags ?? []} />{reason && <p className="mt-1 truncate text-xs italic text-slate-500">{shortText(reason, 120)}</p>}</div></div><div className="flex shrink-0 items-center gap-3"><Score score={candidate.qualityScore} /><button className="btn-ghost" onClick={() => onView(candidate.id)}>Ver ficha</button></div></div>;
}

type InputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  disabled?: boolean;
};

function Input({ label, value, onChange, type = "text", required = false, disabled = false }: InputProps) {
  return <div><label className="label">{label}</label><input className="field" type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} disabled={disabled} /></div>;
}
function PagePad({ children }: { children: ReactNode }) { return <div className="flex-1 p-6">{children}</div>; }
function Empty({ text }: { text: string }) { return <div className="card flex items-center gap-2 p-5 text-sm text-slate-500"><Database size={16} /> {text}</div>; }
function ErrorBox({ message }: { message: string }) { return <div className="mb-3 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={16} /> {message}</div>; }
function Skeleton() { return <div className="card h-40 animate-pulse bg-slate-100" />; }
function Avatar({ name, small = false }: { name: string; small?: boolean }) { const initials = name.split(" ").map((x) => x[0]).join("").slice(0, 2).toUpperCase(); return <div className={`grid shrink-0 place-items-center rounded-md bg-teal font-bold text-white ${small ? "h-10 w-10" : "h-16 w-16 text-xl"}`}>{initials || <UserRound />}</div>; }
function TagList({ tags }: { tags: string[] }) { const visible = tags.filter((tag) => tag && tag.length <= 40).slice(0, 4); return <div className="mt-2 flex flex-wrap gap-1">{visible.map((t) => <span className="rounded-full bg-teal/10 px-2 py-0.5 text-xs font-semibold text-teal" key={t}>{shortText(t, 32)}</span>)}</div>; }
function Score({ score }: { score: number }) { return <div className="min-w-24"><div className="text-right text-sm font-extrabold">{score}%</div><div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-teal" style={{ width: `${Math.max(0, Math.min(100, score))}%` }} /></div></div>; }
function InfoCard({ title, text }: { title: string; text: string }) { return <div className="card whitespace-pre-line p-4"><h3 className="mb-2 font-bold">{title}</h3><p className="text-sm text-slate-600">{text}</p></div>; }
function Table({ title, rows, empty, columns }: any) { return <div className="card overflow-hidden"><div className="border-b border-slate-200 p-4 font-bold">{title}</div>{rows.length === 0 ? <div className="p-4 text-sm text-slate-500">{empty}</div> : <div className="overflow-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{columns.map((c: string) => <th className="px-4 py-2" key={c}>{c}</th>)}</tr></thead><tbody>{rows.map((r: any) => <tr className="border-t border-slate-100" key={r.id}>{columns.map((c: string) => <td className="px-4 py-2" key={c}>{String(r[c] ?? "")}</td>)}</tr>)}</tbody></table></div>}</div>; }
function list(value: string) { return value.split(",").map((x) => x.trim()).filter(Boolean); }
