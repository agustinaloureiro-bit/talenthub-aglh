import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AlertCircle, Bot, Briefcase, CheckCircle2, ChevronLeft, Database, Download, ExternalLink, FileText, GraduationCap, Languages, LayoutDashboard, LogOut, Mail, MapPin, Phone, Plug, Plus, Save, Search, Send, Settings, UserRound, Users } from "lucide-react";
import { API_URL, api, authHeaders, currentUser, login, logout, type User } from "./lib/api";

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
  documentCount?: number;
  primaryDocumentName?: string | null;
  status: string;
};

type CandidateDocument = {
  id: string;
  type?: string;
  file_name?: string;
  file_url?: string | null;
  raw_text?: string | null;
  mime_type?: string | null;
  source_type?: string | null;
  source_path?: string | null;
  created_at?: string;
  is_primary_cv?: boolean;
  has_stored_file?: boolean;
};

type CvAnalysis = {
  hasReadableText: boolean;
  summary?: string | null;
  roles: string[];
  skills: string[];
  languages: Array<{ lang: string; level?: string | null; evidence?: string }>;
  years?: number | null;
  city?: string | null;
  country?: string | null;
  experienceHighlights: string[];
  educationHighlights: string[];
  confidence: "alta" | "media" | "baja";
  warning?: string | null;
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
  const [showImport, setShowImport] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState<{ total: number; returned: number } | null>(null);
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api<{ data: Candidate[]; meta?: { total: number; returned: number } }>(`/candidates?search=${encodeURIComponent(search)}`);
      setItems(response.data);
      setMeta(response.meta ?? { total: response.data.length, returned: response.data.length });
    } catch (err: any) {
      setItems([]);
      setError(err.message || "No se pudieron cargar los candidatos.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);
  return (
    <PagePad>
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="field max-w-md" placeholder="Buscar por nombre, rol o tag" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
        <button className="btn-ghost" onClick={load} disabled={loading}><Search size={16} /> {loading ? "Cargando..." : "Buscar"}</button>
        <button className="btn-ghost" onClick={() => setShowImport(!showImport)}><Database size={16} /> Importar candidatos</button>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}><Plus size={16} /> Nuevo candidato</button>
      </div>
      {error && <ErrorBox message={error} />}
      {!error && meta && <div className="mb-3 text-sm text-slate-500">{meta.total} candidatos en base · mostrando {meta.returned}</div>}
      {showImport && <CandidateImportPanel onImported={() => { setShowImport(false); load(); }} />}
      {showForm && <CandidateForm onSaved={() => { setShowForm(false); load(); }} />}
      <div className="grid gap-3">
        {!loading && !error && items.length === 0 && <Empty text="No hay candidatos cargados. Crea el primero o conecta una integracion real." />}
        {items.map((c) => <CandidateRow key={c.id} candidate={c} onView={onView} />)}
      </div>
    </PagePad>
  );
}

function CandidateImportPanel({ onImported }: { onImported: () => void }) {
  const [sourceType, setSourceType] = useState("manual");
  const [data, setData] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function readFile(file?: File) {
    if (!file) return;
    setError("");
    const text = await file.text();
    setData(text);
    setMessage(`${file.name} cargado para importar.`);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!data.trim()) {
      setError("Pega texto o carga un archivo primero.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await api<{ meta: { total: number; created: number; updated: number; skipped: number } }>("/candidates/import", {
        method: "POST",
        body: JSON.stringify({ sourceType, data })
      });
      setMessage(`${response.meta.created} nuevos, ${response.meta.updated} actualizados, ${response.meta.skipped} omitidos.`);
      onImported();
    } catch (err: any) {
      setError(err.message || "No se pudo importar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card mb-4 grid gap-3 p-4">
      <div className="grid gap-3 md:grid-cols-[220px_1fr]">
        <div>
          <label className="label">Fuente</label>
          <select className="field" value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
            <option value="manual">Manual / planilla</option>
            <option value="buscojobs_export">Buscojobs export</option>
            <option value="gmail_export">Gmail / emails</option>
            <option value="drive_export">Drive / CVs</option>
            <option value="yoiners_export">Yoiners export</option>
            <option value="aglh_export">AGLH export</option>
          </select>
        </div>
        <div>
          <label className="label">Archivo CSV/TSV/TXT/JSON</label>
          <input className="field" type="file" accept=".csv,.tsv,.txt,.json" onChange={(e) => readFile(e.target.files?.[0])} />
        </div>
      </div>
      <div>
        <label className="label">Datos</label>
        <textarea
          className="field min-h-48 font-mono text-xs"
          placeholder="Pega aca candidatos, CVs, correos o una exportacion con columnas como nombre, email, telefono, cargo, ciudad, tags..."
          value={data}
          onChange={(e) => setData(e.target.value)}
        />
      </div>
      {error && <ErrorBox message={error} />}
      {message && <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}
      <button className="btn-primary w-fit" disabled={busy}><Database size={16} /> {busy ? "Importando..." : "Importar a candidatos"}</button>
    </form>
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
      <div className="md:col-span-2"><label className="label">Resumen</label><textarea className="field" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></div>
      <button className="btn-primary md:col-span-2"><Save size={16} /> Guardar candidato</button>
    </form>
  );
}

function TalentFinder({ onView }: { onView: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [seniority, setSeniority] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [refreshSources, setRefreshSources] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [searchStatus, setSearchStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  async function run() {
    if (!query.trim()) return;
    setLoading(true);
    setHasSearched(true);
    setSearchStatus(refreshSources ? "Actualizando fuentes conectadas y buscando..." : "Buscando...");
    try {
      const response = await api<{ data: any[]; sync?: { ran: boolean; sources: number; imported: number; errors: number } }>("/search/talent", { method: "POST", body: JSON.stringify({ query, refreshSources, filters: { seniority: seniority || undefined, activeOnly } }) });
      setResults(response.data);
      setSearchStatus(response.sync?.ran ? `Fuentes consultadas: ${response.sync.sources}. Importados/actualizados: ${response.sync.imported}. Errores u omitidos: ${response.sync.errors}.` : "");
    } catch (err: any) {
      setSearchStatus(err.message || "No se pudo completar la busqueda.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <PagePad>
      <textarea className="field min-h-36" placeholder="Pegá o escribí la descripción del cargo..." value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="my-3 flex flex-wrap items-center gap-3">
        <select className="field max-w-48" value={seniority} onChange={(e) => setSeniority(e.target.value)}><option value="">Todo seniority</option><option>Junior</option><option>Semi-Senior</option><option>Senior</option><option>Lead</option><option>Manager</option></select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> Solo activos</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={refreshSources} onChange={(e) => setRefreshSources(e.target.checked)} /> Sincronizar antes de buscar</label>
        <button className="btn-primary" onClick={run} disabled={!query.trim() || loading}><Search size={16} /> {loading ? "Buscando..." : "Buscar candidatos"}</button>
      </div>
      {searchStatus && <div className="mb-3 rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-600">{searchStatus}</div>}
      {hasSearched && <div className="mb-3 text-sm text-slate-500">{results.length} candidatos encontrados · ordenados por compatibilidad con esta búsqueda</div>}
      <div className="grid gap-3">{!hasSearched && <Empty text="Escribí lo que necesitás para calcular la compatibilidad sobre los CVs." />}{hasSearched && !loading && results.length === 0 && <Empty text="La búsqueda no encontró candidatos con evidencia suficiente en los CVs disponibles." />}{results.map((c) => <CandidateRow key={c.id} candidate={{ ...c, sourceCount: c.sourceCount ?? 0, documentCount: c.documentCount ?? 0, primaryDocumentName: c.primaryDocumentName ?? null, email: c.email ?? [], phone: c.phone ?? [], languages: [], strengths: [], weaknesses: [], status: "active" }} onView={onView} reason={c.matchReason} matchScore={c.score} />)}</div>
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
  const documents = (data.documents ?? []) as CandidateDocument[];
  const primaryDocument = documents.find((doc) => doc.is_primary_cv && doc.has_stored_file)
    ?? documents.find((doc) => doc.has_stored_file)
    ?? documents.find((doc) => doc.is_primary_cv)
    ?? documents[0];
  const cvAnalysis = data.cvAnalysis as CvAnalysis | undefined;
  const summary = cleanDisplayText(cvAnalysis?.summary) || readableCandidateSummary(c, primaryDocument);
  return (
    <PagePad>
      <section className="card mb-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 gap-4"><Avatar name={c.fullName} /><div className="min-w-0"><h2 className="break-words text-2xl font-extrabold">{c.fullName}</h2><p className="text-slate-500">{c.currentRole || "Sin rol actual"} · {[c.city, c.country].filter(Boolean).join(", ") || "Sin ubicación"}</p><TagList tags={c.tags} />{primaryDocument && <p className="mt-2 flex items-center gap-2 text-sm text-slate-500"><FileText size={15} /> {shortText(primaryDocument.file_name, 120)}</p>}</div></div>
          <div className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800"><CheckCircle2 size={16} /> {primaryDocument ? "CV disponible" : "Sin CV"}</div>
        </div>
      </section>
      <div className="mb-4 flex flex-wrap gap-2">{["resumen", "experiencia", "formacion", "documentos", "procesos", "ia"].map((t) => <button key={t} onClick={() => setTab(t)} className={tab === t ? "btn-primary" : "btn-ghost"}>{t}</button>)}</div>
      {tab === "resumen" && <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]"><div className="grid gap-4"><InfoCard title="Resumen respaldado por el CV" text={summary} /><CvAnalysisCard analysis={cvAnalysis} /><KeyDataCard candidate={c} document={primaryDocument} /></div><div className="grid gap-4"><ContactCard candidate={c} /><DocumentMiniCard candidateId={id} document={primaryDocument} onOpenDocuments={() => setTab("documentos")} /></div></div>}
      {tab === "experiencia" && <ChildList rows={data.work} empty="Sin experiencia registrada." fields={["company", "position", "start_date", "end_date", "description"]} canEdit={canEdit} kind="work" id={id} onSaved={load} />}
      {tab === "formacion" && <ChildList rows={data.education} empty="Sin formación registrada." fields={["institution", "degree", "field", "start_year", "end_year"]} canEdit={canEdit} kind="education" id={id} onSaved={load} />}
      {tab === "documentos" && <ChildList rows={documents} empty="Sin documentos registrados." fields={["type", "file_name", "source_type", "created_at"]} canEdit={canEdit} kind="documents" id={id} onSaved={load} />}
      {tab === "procesos" && <ChildList rows={data.processes} empty="Sin procesos registrados." fields={["process_name", "client", "stage", "event_date"]} canEdit={canEdit} kind="processes" id={id} onSaved={load} />}
      {tab === "ia" && <div className="grid gap-4 md:grid-cols-3"><InfoCard title="Fortalezas" text={c.strengths?.join("\n") || "Sin fortalezas registradas."} /><InfoCard title="Áreas de oportunidad" text={c.weaknesses?.join("\n") || "Sin áreas registradas."} /><InfoCard title="Seniority" text={`${c.seniority || "Sin estimación"} ${c.years ? `· ${c.years} años` : ""}`} /></div>}
    </PagePad>
  );
}

function ChildList({ rows, empty, fields, canEdit, kind, id, onSaved }: any) {
  const [open, setOpen] = useState(false);
  if (kind === "documents") {
    return <div className="grid gap-3">{canEdit && <button className="btn-primary w-fit" onClick={() => setOpen(!open)}><Plus size={16} /> Agregar</button>}{open && <ChildForm kind={kind} id={id} onSaved={() => { setOpen(false); onSaved(); }} />}<DocumentList rows={rows} empty={empty} candidateId={id} /></div>;
  }
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
  return <div className="flex flex-1 overflow-hidden"><aside className="w-72 border-r border-slate-200 bg-white p-4"><button className="btn-primary mb-4 w-full" onClick={newSession}><Plus size={16} /> Nueva conversación</button>{sessions.map((s) => <button key={s.id} onClick={() => setSession(s.id)} className={`mb-1 block w-full rounded-md px-3 py-2 text-left text-sm ${session === s.id ? "bg-teal/10 text-teal" : "hover:bg-slate-50"}`}>{s.title}</button>)}</aside><section className="flex flex-1 flex-col"><div className="flex-1 space-y-3 overflow-auto p-6">{messages.length === 0 && <Empty text="Abrí una conversación y consultá sobre candidatos reales." />}{messages.map((m) => <div key={m.id} className={`max-w-2xl rounded-lg p-3 text-sm ${m.role === "user" ? "ml-auto bg-teal text-white" : "bg-white border border-slate-200"}`}>{m.content}</div>)}{candidates.map((c) => <CandidateRow key={c.id} candidate={{ ...c, qualityScore: c.qualityScore ?? 0, sourceCount: c.sourceCount ?? 0, email: c.email ?? [], phone: c.phone ?? [], languages: [], strengths: [], weaknesses: [], status: "active" }} onView={onView} reason={c.matchReason} matchScore={c.score} />)}</div><div className="border-t border-slate-200 bg-white p-4"><div className="flex gap-2"><textarea className="field min-h-12" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} /><button className="btn-primary" onClick={send}><Send size={16} /></button></div></div></section></div>;
}

function Integrations({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = useState<any>({ data: [], logs: [], rejected: [] });
  const [editing, setEditing] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkError, setBulkError] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingSource, setSyncingSource] = useState<string | null>(null);
  const [takeoutUploading, setTakeoutUploading] = useState(false);
  const load = () => api<any>("/integrations").then(setData);
  useEffect(() => { load(); }, []);
  async function save(id: string, status: string) { await api(`/integrations/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }); load(); }
  function sourceCanContinue(id: string, message: string) {
    return id === "gmail" && /Quedan mas correos|Se corto por tiempo/i.test(message);
  }
  async function syncSourceBatches(id: string, maxBatches: number, label = id) {
    let totalNew = 0;
    let totalUpdated = 0;
    let totalErrors = 0;
    let batches = 0;
    let lastMessage = "";
    for (let batch = 1; batch <= maxBatches; batch += 1) {
      batches = batch;
      setSyncMessage(`${label}: procesando tanda ${batch}${maxBatches > 1 ? ` de hasta ${maxBatches}` : ""}...`);
      const result = await api<{ data: any }>(`/integrations/${id}/sync`, { method: "POST" });
      const log = result.data;
      totalNew += Number(log.new_records ?? 0);
      totalUpdated += Number(log.updated_records ?? 0);
      totalErrors += Number(log.errors ?? 0);
      lastMessage = String(log.message ?? "");
      if (!sourceCanContinue(id, lastMessage)) break;
    }
    return { totalNew, totalUpdated, totalErrors, batches, lastMessage };
  }
  async function runGmailHistoricalBackfill() {
    setSyncingSource("gmail");
    setSyncMessage("Gmail historico: reiniciando barrido completo...");
    try {
      const first = await api<{ data: any }>("/integrations/gmail/backfill-start", { method: "POST" });
      const firstLog = first.data;
      let totalNew = Number(firstLog.new_records ?? 0);
      let totalUpdated = Number(firstLog.updated_records ?? 0);
      let totalErrors = Number(firstLog.errors ?? 0);
      let lastMessage = String(firstLog.message ?? "");
      let batches = 1;
      if (sourceCanContinue("gmail", lastMessage)) {
        const rest = await syncSourceBatches("gmail", 499, "Gmail historico");
        totalNew += rest.totalNew;
        totalUpdated += rest.totalUpdated;
        totalErrors += rest.totalErrors;
        lastMessage = rest.lastMessage || lastMessage;
        batches += rest.batches;
      }
      setSyncMessage(`Gmail historico completo/pausado: ${totalNew} nuevos, ${totalUpdated} actualizados, ${totalErrors} errores/omitidos en ${batches} tandas. ${lastMessage}`);
      load();
    } catch (err: any) {
      setSyncMessage(err.message || "No se pudo ejecutar el historico de Gmail.");
      load();
    } finally {
      setSyncingSource(null);
    }
  }
  async function importGmailTakeout(file?: File) {
    if (!file) return;
    const maxBytes = 300 * 1024 * 1024;
    if (file.size > maxBytes) {
      setSyncMessage("Ese archivo pesa mas de 300 MB. En Google Takeout elegi dividir el export en partes mas chicas y subi una parte por vez.");
      return;
    }
    setTakeoutUploading(true);
    setSyncMessage(`Importando historico Gmail desde ${file.name}...`);
    try {
      const response = await fetch(`${API_URL}/integrations/gmail/takeout-import?fileName=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/octet-stream" },
        body: await file.arrayBuffer()
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "No se pudo importar el archivo Gmail.");
      setSyncMessage(payload.data?.message || "Historico Gmail importado.");
      load();
    } catch (err: any) {
      setSyncMessage(err.message || "No se pudo importar el historico Gmail.");
      load();
    } finally {
      setTakeoutUploading(false);
    }
  }
  async function sync(id: string) {
    setSyncingSource(id);
    setSyncMessage(`Sincronizando ${id}...`);
    try {
      const result = await syncSourceBatches(id, id === "gmail" ? 200 : 1, id === "gmail" ? "Gmail" : id);
      setSyncMessage(`${id === "gmail" ? "Gmail" : id}: ${result.totalNew} nuevos, ${result.totalUpdated} actualizados, ${result.totalErrors} errores/omitidos. ${result.lastMessage}`);
      load();
    } catch (err: any) {
      setSyncMessage(err.message || "No se pudo sincronizar.");
      load();
    } finally {
      setSyncingSource(null);
    }
  }
  async function syncAll() {
    setSyncingAll(true);
    setSyncMessage("Sincronizando todas las fuentes conectadas...");
    try {
      const result = await api<{ data: any[]; meta: { sources: number; imported: number; errors: number; message: string } }>("/integrations/sync-all", { method: "POST" });
      let imported = Number(result.meta.imported ?? 0);
      let errors = Number(result.meta.errors ?? 0);
      const gmailLog = (result.data ?? []).find((row) => row.integration_id === "gmail" || String(row.source ?? "").toLowerCase() === "gmail");
      const gmailMessage = String(gmailLog?.message ?? "");
      let extraMessage = "";
      if (sourceCanContinue("gmail", gmailMessage)) {
        const gmail = await syncSourceBatches("gmail", 200, "Gmail historico");
        imported += gmail.totalNew + gmail.totalUpdated;
        errors += gmail.totalErrors;
        extraMessage = ` Gmail continuo ${gmail.batches} tandas extra: ${gmail.totalNew} nuevos, ${gmail.totalUpdated} actualizados. ${gmail.lastMessage}`;
      }
      setSyncMessage(`Fuentes actualizadas: ${result.meta.sources}. Registros importados/actualizados: ${imported}. Errores u omitidos: ${errors}.${extraMessage} Si una fuente queda en rojo, abri Configurar en esa tarjeta para completar el paso pendiente.`);
      load();
    } catch (err: any) {
      setSyncMessage(err.message || "No se pudieron sincronizar las fuentes.");
      load();
    } finally {
      setSyncingAll(false);
    }
  }
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
  "yoiners": { "baseUrl": "", "loginUrl": "", "username": "", "password": "", "searchUrls": "" },
  "aglh": { "baseUrl": "", "loginUrl": "", "username": "", "password": "", "searchUrls": "" },
  "gmail": { "clientId": "", "clientSecret": "", "refreshToken": "", "sessionCookies": "", "searchUrls": "" },
  "drive": { "clientId": "", "clientSecret": "", "refreshToken": "", "sessionCookies": "", "searchUrls": "" },
  "buscojobs": { "username": "", "password": "" }
}`;
  const sources = data.data ?? [];
  const readyCount = sources.filter((item: any) => item.status === "connected" && !String(item.config?.sessionStatus ?? "").startsWith("requires_")).length;
  const errorCount = sources.filter((item: any) => item.status === "error" || String(item.config?.sessionStatus ?? "").startsWith("requires_")).length;
  const importedCount = sources.reduce((sum: number, item: any) => sum + Number(item.total_imported ?? 0), 0);
  return (
    <PagePad>
      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Guarda solo cuentas propias y fuentes donde tengas permiso de extraccion. Los valores sensibles quedan ocultos despues de guardarlos.
      </div>
      {data.meta?.syncEngineVersion && <div className="mb-4 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-500">Motor de sincronizacion: {data.meta.syncEngineVersion}</div>}
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <InfoMetric label="Fuentes listas" value={readyCount} />
        <InfoMetric label="Fuentes con accion pendiente" value={errorCount} />
        <InfoMetric label="Registros fuente leidos" value={importedCount} />
      </div>
      {syncMessage && <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">{syncMessage}</div>}
      {canEdit && (
        <div className="card mb-4 flex flex-wrap gap-2 p-4">
          <button className="btn-primary" onClick={syncAll} disabled={syncingAll}>{syncingAll ? "Sincronizando..." : "Sincronizar todo"}</button>
          <button className="btn-primary" onClick={() => { setBulkOpen(!bulkOpen); if (!bulkText) setBulkText(template); }}><Settings size={16} /> Cargar todas las cuentas</button>
          {bulkOpen && (
            <form onSubmit={applyBulk} className="mt-4 grid w-full gap-3">
              {bulkError && <ErrorBox message={bulkError} />}
              <textarea className="field min-h-52 font-mono text-xs" value={bulkText} onChange={(e) => setBulkText(e.target.value)} />
              <button className="btn-primary w-fit"><Save size={16} /> Guardar todas</button>
            </form>
          )}
        </div>
      )}
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {sources.map((i: any) => {
          const next = integrationNextStep(i);
          const isSyncing = syncingSource === i.id;
          return (
            <div className="card p-4" key={i.id}>
              <div className="mb-2 flex items-center justify-between">
                <div className="font-bold">{i.name}</div>
                <span className={`rounded-full px-2 py-1 text-xs ${i.status === "error" ? "bg-red-50 text-red-700" : i.status === "connected" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{i.status}</span>
              </div>
              <p className="text-sm text-slate-500">Ultima sync: {i.last_sync_at ? new Date(i.last_sync_at).toLocaleString() : "Nunca"} - {i.total_imported} registros</p>
              <IntegrationDiagnostic integration={i} />
              <div className={`mt-3 rounded-md border p-3 text-xs ${next.kind === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : next.kind === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                <div className="font-semibold">{next.title}</div>
                <div className="mt-1">{next.body}</div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {canEdit && <select className="field max-w-44" value={i.status} onChange={(e) => save(i.id, e.target.value)}><option value="not_configured">No configurado</option><option value="connected">Conectado</option><option value="warning">Advertencia</option><option value="error">Error</option><option value="soon">Proximamente</option></select>}
                {canEdit && <button className="btn-ghost" onClick={() => setEditing(editing === i.id ? null : i.id)}><Settings size={16} /> {next.action}</button>}
                <button className="btn-primary" onClick={() => sync(i.id)} disabled={isSyncing || syncingAll}>{isSyncing ? "Sincronizando..." : "Sincronizar"}</button>
                {i.id === "gmail" && <button className="btn-ghost" onClick={runGmailHistoricalBackfill} disabled={isSyncing || syncingAll || Boolean(syncingSource)}>Migrar historico Gmail</button>}
                {i.id === "gmail" && <label className={`btn-ghost ${takeoutUploading ? "pointer-events-none opacity-60" : ""}`}>{takeoutUploading ? "Importando..." : "Subir Takeout .zip/.mbox"}<input className="hidden" type="file" accept=".zip,.mbox,.txt" onChange={(e) => importGmailTakeout(e.target.files?.[0])} /></label>}
              </div>
              {editing === i.id && <IntegrationConfigPanelV2 integration={i} onSaved={() => { setEditing(null); load(); }} />}
            </div>
          );
        })}
      </div>
      <Table title="Log de sincronizaciones" rows={data.logs} empty="Sin logs registrados." columns={["source", "status", "new_records", "updated_records", "errors", "message"]} />
      <div className="mt-4"><Table title="Registros rechazados por no ser candidatos reales" rows={data.rejected ?? []} empty="Sin rechazos recientes." columns={["source_type", "extracted_name", "reason", "created_at"]} /></div>
    </PagePad>
  );
}

function InfoMetric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-xs font-semibold uppercase text-slate-500">{label}</div><div className="mt-1 text-2xl font-bold text-slate-900">{value}</div></div>;
}

function integrationNextStep(integration: any) {
  const id = String(integration.id ?? "");
  const config = integration.config ?? {};
  const status = String(config.sessionStatus ?? integration.status ?? "");
  const message = String(config.sessionLastError || config.lastAgentMessage || "");
  if (integration.status === "connected" && !status.startsWith("requires_") && !message.toLowerCase().includes("fallo")) {
    return { kind: "ok", title: "Lista para buscar", body: "Esta fuente esta conectada. Si hay candidatos disponibles, Sincronizar los importa a Candidatos y Talent Finder.", action: "Configurar" };
  }
  if (id === "gmail" || id === "drive") {
    return { kind: "warn", title: "Falta conectar Google", body: id === "gmail" ? "Para el historico grande, no exportes todo el mail: en Gmail etiqueta o filtra correos con CV, exporta esa etiqueta en Google Takeout como .zip y subila aca. Luego el sincronizador trae solo lo nuevo." : "Abri Configurar y usa el bloque OAuth. Con eso TalentHub guarda un refresh token y no tenes que repetir el login cada vez.", action: "Conectar Google" };
  }
  if (id === "buscojobs") {
    return { kind: "warn", title: "Falta detectar el endpoint real de postulantes", body: "Abri Configurar y deja guardado usuario/contrasena o un export historico. Si la API de postulantes cambia, el log va a mostrar exactamente donde fallo.", action: "Configurar Buscojobs" };
  }
  if (id === "aglh" || id === "yoiners") {
    return { kind: "warn", title: "Falta sesion o URL de busqueda", body: "Abri Configurar y guarda URL/base, URL login, usuario/contrasena y las URLs donde aparecen candidatos. Tambien podes cargar un export como respaldo.", action: `Configurar ${integration.name}` };
  }
  return { kind: "neutral", title: "Pendiente de configuracion", body: "Esta fuente todavia no tiene datos suficientes para sincronizar candidatos reales.", action: "Configurar" };
}

function IntegrationDiagnostic({ integration }: { integration: any }) {
  const config = integration.config ?? {};
  const status = config.sessionStatus;
  const message = config.sessionLastError || config.lastAgentMessage;
  if (!status && !message) return null;
  const isError = String(status ?? "").startsWith("requires_") || integration.status === "error";
  return <div className={`mt-3 rounded-md border p-3 text-xs ${isError ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
    {status && <div className="font-semibold">Sesion: {String(status).replace(/_/g, " ")}</div>}
    {message && <div className="mt-1">{shortText(String(message), 220)}</div>}
    {integration.id === "gmail" && (config.gmailSyncMode || config.gmailTotalMatchingMessages || config.gmailHasMore || config.gmailBackfillCompleteAt) && (
      <div className="mt-2 grid gap-1 text-slate-600">
        {config.gmailSyncMode && <div>Modo Gmail: {String(config.gmailSyncMode)}</div>}
        {config.gmailTotalMatchingMessages && <div>Coincidencias aproximadas: {String(config.gmailTotalMatchingMessages)}</div>}
        {config.gmailHasMore && <div>Quedan mas correos para seguir procesando.</div>}
        {config.gmailBackfillCompleteAt && <div>Historico terminado: {new Date(config.gmailBackfillCompleteAt).toLocaleString()}</div>}
        {config.gmailTakeoutImportedAt && <div>Takeout importado: {new Date(config.gmailTakeoutImportedAt).toLocaleString()}</div>}
        {config.gmailTakeoutLastFile && <div>Archivo Takeout: {String(config.gmailTakeoutLastFile)}</div>}
      </div>
    )}
    {config.sessionRefreshedAt && <div className="mt-1 text-slate-500">Renovada: {new Date(config.sessionRefreshedAt).toLocaleString()}</div>}
  </div>;
}

function IntegrationConfigPanelV2({ integration, onSaved }: { integration: any; onSaved: () => void }) {
  const [form, setForm] = useState({
    baseUrl: integration.config?.baseUrl === "********" ? "" : integration.config?.baseUrl ?? "",
    loginUrl: integration.config?.loginUrl === "********" ? "" : integration.config?.loginUrl ?? "",
    apiKey: "",
    accessToken: "",
    refreshToken: "",
    clientId: integration.config?.clientId === "********" ? "" : integration.config?.clientId ?? "",
    clientSecret: "",
    expectedGoogleEmail: integration.config?.expectedGoogleEmail ?? "",
    username: integration.config?.username === "********" ? "" : integration.config?.username ?? "",
    password: "",
    sessionCookies: "",
    searchUrls: integration.config?.searchUrls === "********" ? "" : integration.config?.searchUrls ?? "",
    candidateLinkPattern: integration.config?.candidateLinkPattern === "********" ? "" : integration.config?.candidateLinkPattern ?? "",
    historicalData: "",
    notes: integration.config?.notes === "********" ? "" : integration.config?.notes ?? ""
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [oauthCode, setOauthCode] = useState("");
  const [oauthUrl, setOauthUrl] = useState("");
  const [oauthRedirectUri, setOauthRedirectUri] = useState("");
  const [oauthMessage, setOauthMessage] = useState("");
  const defaultGoogleRedirectUri = `${window.location.origin}/api/integrations/google/callback`;
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
  const isGoogle = integration.id === "gmail" || integration.id === "drive";
  const isWebAgent = integration.id === "aglh" || integration.id === "yoiners" || integration.id === "buscojobs";
  async function createOauthUrl() {
    setError("");
    setOauthMessage("");
    if (!form.clientId.trim() || !form.clientSecret.trim()) {
      setOauthRedirectUri(defaultGoogleRedirectUri);
      setError("Primero crea el cliente OAuth en Google Cloud usando el Redirect URI que aparece abajo. Despues pega Client ID y Client secret aca.");
      return;
    }
    try {
      const response = await api<{ data: { url: string; redirectUri: string } }>(`/integrations/${integration.id}/google-oauth-url`, {
        method: "POST",
        body: JSON.stringify({ clientId: form.clientId, clientSecret: form.clientSecret, expectedGoogleEmail: form.expectedGoogleEmail })
      });
      setOauthUrl(response.data.url);
      setOauthRedirectUri(response.data.redirectUri);
      window.open(response.data.url, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      setError(err.message || "No se pudo generar el link de Google.");
    }
  }
  async function connectOauthCode() {
    setError("");
    setOauthMessage("");
    try {
      const response = await api<{ data: { message: string } }>(`/integrations/${integration.id}/google-oauth-code`, {
        method: "POST",
        body: JSON.stringify({ code: oauthCode, clientId: form.clientId, clientSecret: form.clientSecret, expectedGoogleEmail: form.expectedGoogleEmail })
      });
      setOauthMessage(response.data.message);
      onSaved();
    } catch (err: any) {
      setError(err.message || "No se pudo conectar Google.");
    }
  }
  return (
    <form onSubmit={saveConfig} className="mt-4 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4">
      {error && <ErrorBox message={error} />}
      {oauthMessage && <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{oauthMessage}</div>}
      <div className="grid gap-3 md:grid-cols-2">
        {isWebAgent && <Input label="URL/base" value={form.baseUrl} onChange={(v) => setForm({ ...form, baseUrl: v })} />}
        {isWebAgent && <Input label="URL login" value={form.loginUrl} onChange={(v) => setForm({ ...form, loginUrl: v })} />}
        {isGoogle && <Input label="Client ID" value={form.clientId} onChange={(v) => setForm({ ...form, clientId: v })} />}
        {isGoogle && <Input label="Client secret" type="password" value={form.clientSecret} onChange={(v) => setForm({ ...form, clientSecret: v })} />}
        {isGoogle && <Input label={integration.id === "gmail" ? "Cuenta Gmail esperada" : "Cuenta Google esperada"} value={form.expectedGoogleEmail} onChange={(v) => setForm({ ...form, expectedGoogleEmail: v })} />}
        {isGoogle && <Input label="Refresh token" type="password" value={form.refreshToken} onChange={(v) => setForm({ ...form, refreshToken: v })} />}
        {isGoogle && <Input label="Access token temporal" type="password" value={form.accessToken} onChange={(v) => setForm({ ...form, accessToken: v })} />}
        {!isGoogle && <Input label="Usuario/email" value={form.username} onChange={(v) => setForm({ ...form, username: v })} />}
        {!isGoogle && <Input label="Contrasena" type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} />}
        <Input label={integration.id === "buscojobs" ? "Token/API opcional" : "API key/token opcional"} type="password" value={form.apiKey} onChange={(v) => setForm({ ...form, apiKey: v })} />
      </div>
      {integration.id === "buscojobs" && <p className="text-xs text-slate-500">Para Buscojobs, completa usuario/email y contrasena. TalentHub intenta iniciar sesion y guardar la sesion renovada al sincronizar.</p>}
      {isGoogle && (
        <div className="grid gap-3 rounded-md border border-slate-200 bg-white p-3">
          {integration.config?.connectedGoogleEmail && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <span className="font-semibold">Cuenta conectada:</span> {integration.config.connectedGoogleEmail}
            </div>
          )}
          {integration.id === "gmail" && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Para importar CVs del buzón de selección, escribí arriba el email exacto de esa cuenta y después tocá Generar link Google. En Google elegí esa cuenta, no la personal.
            </div>
          )}
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <div className="font-semibold">Redirect URI para Google Cloud</div>
            <div className="mt-1 break-all font-mono">{oauthRedirectUri || defaultGoogleRedirectUri}</div>
            <div className="mt-1">Copia esta URL en Google Cloud cuando te pida Authorized redirect URI.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost" onClick={createOauthUrl}>Generar link Google</button>
            {oauthUrl && <a className="btn-ghost" href={oauthUrl} target="_blank" rel="noreferrer">Abrir link</a>}
          </div>
          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <input className="field" placeholder="Pega aca el codigo que devuelve Google" value={oauthCode} onChange={(e) => setOauthCode(e.target.value)} />
            <button type="button" className="btn-primary" onClick={connectOauthCode}>Conectar OAuth</button>
          </div>
        </div>
      )}
      {(integration.id === "aglh" || integration.id === "yoiners" || isGoogle) && <div className="grid gap-3 md:grid-cols-2"><div><label className="label">URLs donde buscar candidatos</label><textarea className="field min-h-24" placeholder="Una o varias URLs separadas por coma o punto y coma." value={form.searchUrls} onChange={(e) => setForm({ ...form, searchUrls: e.target.value })} /></div><Input label="Patron links candidatos" value={form.candidateLinkPattern} onChange={(v) => setForm({ ...form, candidateLinkPattern: v })} /></div>}
      <div><label className="label">Sesion/cookies exportadas</label><textarea className="field min-h-24" placeholder="Opcional. Dejalo vacio si no sabes que es." value={form.sessionCookies} onChange={(e) => setForm({ ...form, sessionCookies: e.target.value })} /></div>
      <div><label className="label">Archivo historico exportado</label><input className="field" type="file" accept=".csv,.txt,.json" onChange={(e) => loadHistoricalFile(e.target.files?.[0])} /><p className="mt-1 text-xs text-slate-500">Si una plataforma bloquea login automatico, carga aca un exportado de candidatos como respaldo.</p></div>
      <div><label className="label">Datos historicos JSON/CSV</label><textarea className="field min-h-40 font-mono text-xs" placeholder={`Pega aca un exportado de candidatos. Ejemplo CSV:\nnombre,email,telefono,cargo,ciudad\nAna Perez,ana@mail.com,099123456,Analista,Montevideo`} value={form.historicalData} onChange={(e) => setForm({ ...form, historicalData: e.target.value })} /></div>
      <div><label className="label">Notas internas</label><textarea className="field min-h-20" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      <button className="btn-primary w-fit" disabled={saving}><Save size={16} /> {saving ? "Guardando..." : "Guardar configuracion"}</button>
    </form>
  );
}

function IntegrationConfigPanel({ integration, onSaved }: { integration: any; onSaved: () => void }) {
  const [form, setForm] = useState({
    baseUrl: integration.config?.baseUrl === "â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢" ? "" : integration.config?.baseUrl ?? "",
    apiKey: "",
    username: integration.config?.username === "â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢" ? "" : integration.config?.username ?? "",
    password: "",
    sessionCookies: "",
    notes: integration.config?.notes === "â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢" ? "" : integration.config?.notes ?? ""
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

function bestDocumentUrl(document?: CandidateDocument | null) {
  const url = document?.file_url || document?.source_path || "";
  return /^https?:\/\//i.test(url) ? url : "";
}

async function downloadDocument(candidateId: string, document: CandidateDocument) {
  const { blob, fileName } = await fetchDocumentBlob(candidateId, document);
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = fileName;
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function previewDocument(candidateId: string, document: CandidateDocument) {
  const { blob } = await fetchDocumentBlob(candidateId, document);
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function fetchDocumentBlob(candidateId: string, document: CandidateDocument) {
  const response = await fetch(`${API_URL}/candidates/${candidateId}/documents/${document.id}/download`, {
    headers: authHeaders()
  });
  if (!response.ok) throw new Error("No se pudo descargar el documento.");
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const fileName = match?.[1] || document.file_name || "documento";
  return { blob, fileName };
}

function cleanDisplayText(value: unknown) {
  const text = String(value ?? "")
    .replace(/Ã¡/g, "á").replace(/Ã©/g, "é").replace(/Ã­/g, "í").replace(/Ã³/g, "ó").replace(/Ãº/g, "ú")
    .replace(/Ã±/g, "ñ").replace(/Ã/g, "Á").replace(/Ã‰/g, "É").replace(/Ã/g, "Í").replace(/Ã“/g, "Ó")
    .replace(/Ãš/g, "Ú").replace(/Ã‘/g, "Ñ").replace(/Â·/g, "·").replace(/Â/g, "")
    .replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (/^%PDF-|endobj|xref|\/FlateDecode|Google Docs Renderer/i.test(text)) return "";
  return text;
}

function readableCandidateSummary(candidate: Candidate, document?: CandidateDocument) {
  const summary = cleanDisplayText(candidate.summary);
  if (summary && !/CV importado\. Faltan datos legibles/i.test(summary)) return summary;
  const raw = cleanDisplayText(document?.raw_text);
  if (!raw) return "Sin resumen confiable registrado. El CV esta disponible para revisar.";
  const sentences = raw
    .split(/(?<=[.;])\s+|\n+/)
    .map(cleanDisplayText)
    .filter((line) => line.length > 25 && !/@/.test(line))
    .slice(0, 4);
  return sentences.length ? sentences.join("\n") : "CV importado. Faltan datos legibles para resumir.";
}

function KeyDataCard({ candidate, document }: { candidate: Candidate; document?: CandidateDocument }) {
  const rows = [
    ["Rol", candidate.currentRole || "Sin dato"],
    ["Ubicacion", [candidate.city, candidate.country].filter(Boolean).join(", ") || "Sin dato"],
    ["Celular/telefono", candidate.phone[0] || "Sin dato"],
    ["Email", candidate.email[0] || "Sin dato"],
    ["CV", document?.file_name || "Sin CV disponible"]
  ];
  return <div className="card p-4"><h3 className="mb-3 font-bold">Datos clave</h3><div className="grid gap-2">{rows.map(([label, value]) => <div key={label} className="grid gap-1 rounded-md border border-slate-100 px-3 py-2 text-sm md:grid-cols-[130px_1fr]"><span className="font-semibold text-slate-500">{label}</span><span className="break-words text-slate-800">{value}</span></div>)}</div></div>;
}

function CvAnalysisCard({ analysis }: { analysis?: CvAnalysis }) {
  if (!analysis?.hasReadableText) {
    return <div className="card p-4"><h3 className="mb-2 font-bold">Información detectada</h3><p className="text-sm text-slate-500">No hay texto suficiente para analizar este CV con confianza. El archivo original sigue disponible para revisión.</p></div>;
  }
  const items = [
    { icon: Briefcase, label: "Áreas y competencias", values: [...analysis.roles, ...analysis.skills] },
    { icon: Languages, label: "Idiomas", values: analysis.languages.map((item) => `${item.lang}${item.level ? ` · ${item.level}` : " · nivel no indicado"}`) },
    { icon: MapPin, label: "Ubicación", values: [[analysis.city, analysis.country].filter(Boolean).join(", ")].filter(Boolean) },
    { icon: GraduationCap, label: "Formación mencionada", values: analysis.educationHighlights.slice(0, 3) }
  ].filter((item) => item.values.length);
  return <div className="card p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">Información detectada en el CV</h3><span className={`rounded-full px-2 py-1 text-xs font-semibold ${analysis.confidence === "alta" ? "bg-emerald-50 text-emerald-700" : analysis.confidence === "media" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>Confiabilidad {analysis.confidence}</span></div>{analysis.warning && <p className="mb-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">{analysis.warning}</p>}<div className="grid gap-3">{items.map(({ icon: Icon, label, values }) => <div key={label} className="grid gap-2 rounded-md border border-slate-100 p-3 md:grid-cols-[180px_1fr]"><div className="flex items-center gap-2 text-sm font-semibold text-slate-600"><Icon size={16} /> {label}</div><div className="flex flex-wrap gap-2">{values.map((value) => <span key={value} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">{value}</span>)}</div></div>)}{analysis.experienceHighlights.length > 0 && <div className="rounded-md border border-slate-100 p-3"><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-600"><Briefcase size={16} /> Evidencia de experiencia</div><ul className="grid gap-2 text-sm text-slate-700">{analysis.experienceHighlights.slice(0, 4).map((value) => <li key={value} className="border-l-2 border-teal pl-3">{value}</li>)}</ul></div>}</div><p className="mt-3 text-xs text-slate-500">Se muestran solamente datos encontrados en el texto del CV. TalentHub no completa información ausente.</p></div>;
}

function ContactCard({ candidate }: { candidate: Candidate }) {
  const items = [
    ...candidate.email.slice(0, 3).map((value) => ({ icon: Mail, label: value, href: `mailto:${value}` })),
    ...candidate.phone.slice(0, 3).map((value) => ({ icon: Phone, label: value, href: `tel:${value.replace(/\s+/g, "")}` })),
    ...(candidate.linkedinUrl ? [{ icon: ExternalLink, label: "LinkedIn", href: candidate.linkedinUrl }] : [])
  ];
  return <div className="card p-4"><h3 className="mb-3 font-bold">Contacto</h3>{items.length === 0 ? <p className="text-sm text-slate-500">Sin datos de contacto.</p> : <div className="grid gap-2">{items.map(({ icon: Icon, label, href }) => <a key={`${href}-${label}`} className="flex min-w-0 items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50" href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer"><Icon size={15} /><span className="truncate">{label}</span></a>)}</div>}</div>;
}

function DocumentMiniCard({ candidateId, document, onOpenDocuments }: { candidateId: string; document?: CandidateDocument; onOpenDocuments: () => void }) {
  const [error, setError] = useState("");
  if (!document) return <div className="card p-4"><h3 className="mb-2 font-bold">CV</h3><p className="text-sm text-slate-500">Sin CV/documentos importados.</p></div>;
  const url = bestDocumentUrl(document);
  return <div className="card p-4"><h3 className="mb-2 font-bold">CV principal</h3><p className="mb-3 text-sm text-slate-600">{shortText(document.file_name, 140)}</p><div className="flex flex-wrap gap-2"><button className="btn-primary" onClick={() => previewDocument(candidateId, document).catch((e) => setError(e.message))}><ExternalLink size={16} /> Previsualizar</button><button className="btn-ghost" onClick={() => downloadDocument(candidateId, document).catch((e) => setError(e.message))}><Download size={16} /> Descargar</button>{url && <a className="btn-ghost" href={url} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Origen</a>}<button className="btn-ghost" onClick={onOpenDocuments}><FileText size={16} /> Texto</button></div>{error && <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div>}</div>;
}

function DocumentList({ rows, empty, candidateId }: { rows: CandidateDocument[]; empty: string; candidateId: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (!rows.length) return <Empty text={empty} />;
  return <div className="grid gap-3">{rows.map((doc) => {
    const url = bestDocumentUrl(doc);
    const isOpen = openId === doc.id;
    return <div className="card p-4" key={doc.id}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2 font-bold"><FileText size={17} /> <span className="break-words">{doc.file_name || "Documento importado"}</span></div><div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500"><span>{doc.type || "documento"}</span>{doc.source_type && <span>Fuente: {doc.source_type}</span>}{doc.mime_type && <span>{doc.mime_type}</span>}</div></div><div className="flex shrink-0 flex-wrap gap-2"><button className="btn-primary" onClick={() => previewDocument(candidateId, doc).catch((e) => setError(e.message))}><ExternalLink size={16} /> Previsualizar</button><button className="btn-ghost" onClick={() => downloadDocument(candidateId, doc).catch((e) => setError(e.message))}><Download size={16} /> Descargar</button>{url && <a className="btn-ghost" href={url} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Origen</a>}{doc.raw_text && <button className="btn-ghost" onClick={() => setOpenId(isOpen ? null : doc.id)}><FileText size={16} /> {isOpen ? "Ocultar texto" : "Texto extraido"}</button>}</div></div>{error && <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div>}{isOpen && <pre className="mt-4 max-h-[520px] overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">{cleanDisplayText(doc.raw_text) || "No hay texto legible extraido de este CV."}</pre>}</div>;
  })}</div>;
}

function CandidateRow({ candidate, onView, reason, matchScore }: { candidate: Candidate; onView: (id: string) => void; reason?: string; matchScore?: number }) {
  const role = shortText(candidate.currentRole || "Sin rol", 90);
  const location = shortText(candidate.city || candidate.country || "Sin ciudad", 45);
  const documents = Number(candidate.documentCount ?? 0);
  const contact = [candidate.phone?.[0], candidate.email?.[0]].filter(Boolean).join(" · ");
  const summary = cleanDisplayText(candidate.summary);
  return <div className="card flex flex-wrap items-start justify-between gap-4 p-4"><div className="flex min-w-0 flex-1 gap-3"><Avatar name={candidate.fullName} small /><div className="min-w-0 flex-1"><div className="truncate font-bold">{shortText(candidate.fullName, 90)}</div><div className="truncate text-sm text-slate-500">{role} · {location}{candidate.years ? ` · ${candidate.years} años declarados` : ""}</div>{summary && <p className="mt-2 max-w-3xl text-sm leading-5 text-slate-700">{shortText(summary, 260)}</p>}<div className="mt-2 flex flex-wrap items-center gap-2">{documents > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600"><FileText size={13} /> {documents} CV/doc</span>}{candidate.primaryDocumentName && <span className="max-w-sm truncate text-xs text-slate-500">{shortText(candidate.primaryDocumentName, 70)}</span>}{contact && <span className="max-w-md truncate text-xs text-slate-500">{shortText(contact, 90)}</span>}</div><TagList tags={candidate.tags ?? []} />{reason && <p className="mt-2 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{shortText(reason, 240)}</p>}</div></div><div className="flex shrink-0 items-center gap-3">{typeof matchScore === "number" && <MatchScore score={matchScore} />}<button className={documents > 0 ? "btn-primary" : "btn-ghost"} onClick={() => onView(candidate.id)}>{documents > 0 ? "Ver ficha / CV" : "Ver ficha"}</button></div></div>;
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
function MatchScore({ score }: { score: number }) { return <div className="min-w-28" title="Compatibilidad calculada únicamente para la búsqueda actual"><div className="mb-1 text-right text-xs font-semibold text-slate-500">Coincidencia</div><div className="text-right text-lg font-extrabold text-slate-800">{score}%</div><div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-teal" style={{ width: `${Math.max(0, Math.min(100, score))}%` }} /></div></div>; }
function InfoCard({ title, text }: { title: string; text: string }) { return <div className="card whitespace-pre-line p-4"><h3 className="mb-2 font-bold">{title}</h3><p className="text-sm text-slate-600">{text}</p></div>; }
function Table({ title, rows, empty, columns }: any) { return <div className="card overflow-hidden"><div className="border-b border-slate-200 p-4 font-bold">{title}</div>{rows.length === 0 ? <div className="p-4 text-sm text-slate-500">{empty}</div> : <div className="overflow-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{columns.map((c: string) => <th className="px-4 py-2" key={c}>{c}</th>)}</tr></thead><tbody>{rows.map((r: any) => <tr className="border-t border-slate-100" key={r.id}>{columns.map((c: string) => <td className={`px-4 py-2 align-top ${c === "message" || c === "reason" ? "max-w-xl whitespace-normal break-words text-xs leading-relaxed" : "whitespace-nowrap"}`} key={c} title={String(r[c] ?? "")}>{c === "message" || c === "reason" ? shortText(String(r[c] ?? ""), 220) : String(r[c] ?? "")}</td>)}</tr>)}</tbody></table></div>}</div>; }
function list(value: string) { return value.split(",").map((x) => x.trim()).filter(Boolean); }
