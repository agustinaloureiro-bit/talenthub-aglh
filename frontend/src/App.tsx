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
  return <PagePad><div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Pegá sesiones/API keys solo de cuentas propias y fuentes donde tengas permiso de extracción. Los valores sensibles se guardan en el backend y luego se muestran ocultos.</div>{canEdit && <div className="card mb-4 p-4"><button className="btn-primary" onClick={() => { setBulkOpen(!bulkOpen); if (!bulkText) setBulkText(template); }}><Settings size={16} /> Cargar todas las cuentas</button>{bulkOpen && <form onSubmit={applyBulk} className="mt-4 grid gap-3">{bulkError && <ErrorBox message={bulkError} />}<textarea className="field min-h-52 font-mono text-xs" value={bulkText} onChange={(e) => setBulkText(e.target.value)} /><button className="btn-primary w-fit"><Save size={16} /> Guardar todas</button></form>}</div>}<div className="mb-6 grid gap-4 md:grid-cols-2">{data.data.map((i: any) => <div className="card p-4" key={i.id}><div className="mb-2 flex items-center justify-between"><div className="font-bold">{i.name}</div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{i.status}</span></div><p className="text-sm text-slate-500">Última sync: {i.last_sync_at ? new Date(i.last_sync_at).toLocaleString() : "Nunca"} · {i.total_imported} registros</p><div className="mt-3 flex flex-wrap gap-2">{canEdit && <select className="field max-w-44" value={i.status} onChange={(e) => save(i.id, e.target.value)}><option value="not_configured">No configurado</option><option value="connected">Conectado</option><option value="warning">Advertencia</option><option value="error">Error</option><option value="soon">Próximamente</option></select>}{canEdit && <button className="btn-ghost" onClick={() => setEditing(editing === i.id ? null : i.id)}><Settings size={16} /> Configurar</button>}<button className="btn-primary" onClick={() => sync(i.id)}>Sincronizar</button></div>{editing === i.id && <IntegrationConfigPanel integration={i} onSaved={() => { setEditing(null); load(); }} />}</div>)}</div><Table title="Log de sincronizaciones" rows={data.logs} empty="Sin logs registrados." columns={["source", "status", "new_records", "updated_records", "errors", "message"]} /></PagePad>;
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

function CandidateRow({ candidate, onView, reason }: { candidate: Candidate; onView: (id: string) => void; reason?: string }) {
  return <div className="card flex flex-wrap items-center justify-between gap-4 p-4"><div className="flex min-w-0 gap-3"><Avatar name={candidate.fullName} small /><div><div className="font-bold">{candidate.fullName}</div><div className="text-sm text-slate-500">{candidate.currentRole || "Sin rol"} · {candidate.city || "Sin ciudad"} · {candidate.years ?? 0} años</div><TagList tags={candidate.tags?.slice(0, 5) ?? []} />{reason && <p className="mt-1 text-xs italic text-slate-500">{reason}</p>}</div></div><div className="flex items-center gap-3"><Score score={candidate.qualityScore} /><button className="btn-ghost" onClick={() => onView(candidate.id)}>Ver ficha</button></div></div>;
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
function TagList({ tags }: { tags: string[] }) { return <div className="mt-2 flex flex-wrap gap-1">{tags.map((t) => <span className="rounded-full bg-teal/10 px-2 py-0.5 text-xs font-semibold text-teal" key={t}>{t}</span>)}</div>; }
function Score({ score }: { score: number }) { return <div className="min-w-24"><div className="text-right text-sm font-extrabold">{score}%</div><div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-teal" style={{ width: `${Math.max(0, Math.min(100, score))}%` }} /></div></div>; }
function InfoCard({ title, text }: { title: string; text: string }) { return <div className="card whitespace-pre-line p-4"><h3 className="mb-2 font-bold">{title}</h3><p className="text-sm text-slate-600">{text}</p></div>; }
function Table({ title, rows, empty, columns }: any) { return <div className="card overflow-hidden"><div className="border-b border-slate-200 p-4 font-bold">{title}</div>{rows.length === 0 ? <div className="p-4 text-sm text-slate-500">{empty}</div> : <div className="overflow-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{columns.map((c: string) => <th className="px-4 py-2" key={c}>{c}</th>)}</tr></thead><tbody>{rows.map((r: any) => <tr className="border-t border-slate-100" key={r.id}>{columns.map((c: string) => <td className="px-4 py-2" key={c}>{String(r[c] ?? "")}</td>)}</tr>)}</tbody></table></div>}</div>; }
function list(value: string) { return value.split(",").map((x) => x.trim()).filter(Boolean); }
