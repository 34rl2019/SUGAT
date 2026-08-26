import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './style.css';

const API = import.meta.env.VITE_API_URL;
const SOCKET = import.meta.env.VITE_SOCKET_URL;
type Tab = 'dashboard' | 'drivers' | 'vehicles' | 'stops' | 'routes' | 'schedules' | 'live';
type RecordData = Record<string, any>;
type Data = { dashboard: RecordData; drivers: RecordData[]; vehicles: RecordData[]; stops: RecordData[]; routes: RecordData[]; schedules: RecordData[]; live: RecordData[] };

let accessToken = sessionStorage.getItem('sugat-admin-access') ?? '';
const storeTokens = (tokens: RecordData) => { accessToken = tokens.accessToken; sessionStorage.setItem('sugat-admin-access', tokens.accessToken); sessionStorage.setItem('sugat-admin-refresh', tokens.refreshToken); };
const clearTokens = () => { accessToken = ''; sessionStorage.removeItem('sugat-admin-access'); sessionStorage.removeItem('sugat-admin-refresh'); };
const messageFrom = async (response: Response) => { try { const body = await response.json(); return Array.isArray(body.message) ? body.message.join(', ') : body.message || `Request failed (${response.status})`; } catch { return `Request failed (${response.status})`; } };

async function request(path: string, init: RequestInit = {}) {
  const send = () => fetch(`${API}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}`, ...init.headers } });
  let response = await send();
  const refreshToken = sessionStorage.getItem('sugat-admin-refresh');
  if (response.status === 401 && refreshToken) {
    const refreshed = await fetch(`${API}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
    if (refreshed.ok) { storeTokens(await refreshed.json()); response = await send(); }
  }
  if (!response.ok) throw new Error(await messageFrom(response));
  return response.status === 204 ? null : response.json();
}

const driverName = (driver?: RecordData) => driver ? [driver.firstName, driver.middleName, driver.lastName].filter(Boolean).join(' ') : 'Unassigned';
const localDate = (value?: string) => value ? new Date(value).toLocaleString() : '—';
const statusClass = (active: boolean) => active ? 'status good' : 'status muted';

function App() {
  const [loggedIn, setLoggedIn] = useState(Boolean(accessToken));
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [data, setData] = useState<Data | null>(null); const [tab, setTab] = useState<Tab>('dashboard');
  const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  const [modal, setModal] = useState<{ kind: string; item?: RecordData } | null>(null);

  async function load(quiet = false) {
    if (!quiet) setLoading(true);
    try {
      const [dashboard, drivers, vehicles, stops, routes, schedules, live] = await Promise.all([
        '/admin/dashboard', '/admin/drivers', '/admin/vehicles', '/admin/stops', '/admin/routes', '/admin/schedules', '/admin/live',
      ].map(path => request(path)));
      setData({ dashboard, drivers, vehicles, stops, routes, schedules, live }); setError('');
    } catch (caught) {
      const text = caught instanceof Error ? caught.message : 'Server unavailable.'; setError(text);
      if (/session|unauthorized/i.test(text)) { clearTokens(); setLoggedIn(false); }
    } finally { if (!quiet) setLoading(false); }
  }
  useEffect(() => { if (loggedIn) void load(); }, [loggedIn]);
  useEffect(() => {
    if (!loggedIn) return;
    const socket = io(`${SOCKET}/live`, { auth: { token: accessToken }, transports: ['websocket'] });
    const refresh = () => void load(true);
    socket.on('trip.started', refresh); socket.on('trip.location.updated', refresh); socket.on('trip.completed', refresh);
    return () => { socket.disconnect(); };
  }, [loggedIn]);
  async function login(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError('');
    try { const response = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) }); if (!response.ok) throw new Error(await messageFrom(response)); storeTokens(await response.json()); setLoggedIn(true); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Login failed.'); } finally { setLoading(false); }
  }
  async function mutate(path: string, method: string, body: RecordData | undefined, message: string) {
    setLoading(true); setError(''); setSuccess('');
    try { await request(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) }); await load(true); setModal(null); setSuccess(message); window.setTimeout(() => setSuccess(''), 4000); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Action failed.'); } finally { setLoading(false); }
  }
  if (!loggedIn) return <main className="login"><form onSubmit={login}><span className="brand">SUGAT ADMIN</span><p className="kicker">AYAW HULAT. SUGATA.</p><h1>Operations login</h1><label>Email<input type="email" value={email} onChange={event => setEmail(event.target.value)} required /></label><label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} required /></label>{error && <p className="alert error">{error}</p>}<button className="primary" disabled={loading}>{loading ? 'SIGNING IN…' : 'SIGN IN'}</button></form></main>;

  return <div className="app">
    <aside><div><span className="brand">SUGAT</span><p>ADMIN OPERATIONS</p></div><nav>{(['dashboard', 'drivers', 'vehicles', 'stops', 'routes', 'schedules', 'live'] as Tab[]).map(item => <button className={tab === item ? 'active' : ''} onClick={() => { setTab(item); setError(''); }} key={item}>{item.toUpperCase()}</button>)}</nav><button onClick={() => { clearTokens(); setLoggedIn(false); }}>LOG OUT</button></aside>
    <main className="content"><header><div><p className="kicker">AYAW HULAT. SUGATA.</p><h1>{tab === 'schedules' ? 'SCHEDULES / TRIPS' : tab.toUpperCase()}</h1></div><button className="secondary" onClick={() => load()} disabled={loading}>{loading ? 'REFRESHING…' : 'REFRESH DATA'}</button></header>
      {error && <p className="alert error">{error}</p>}{success && <p className="alert success">{success}</p>}
      {!data ? <Loading /> : <Page tab={tab} data={data} open={setModal} mutate={mutate} />}
    </main>
    {modal && data && <Modal spec={modal} data={data} busy={loading} close={() => setModal(null)} mutate={mutate} />}
  </div>;
}

function Loading() { return <section className="empty"><h2>Loading real operations data…</h2></section>; }
function Empty({ text, action, onClick }: { text: string; action?: string; onClick?: () => void }) { return <section className="empty"><h2>{text}</h2>{action && <button className="primary" onClick={onClick}>{action}</button>}</section>; }
function Toolbar({ search, setSearch, children }: { search: string; setSearch: (value: string) => void; children?: React.ReactNode }) { return <div className="toolbar"><input type="search" placeholder="Search records…" value={search} onChange={event => setSearch(event.target.value)} />{children}</div>; }
function Page({ tab, data, open, mutate }: { tab: Tab; data: Data; open: (value: any) => void; mutate: Function }) {
  if (tab === 'dashboard') return <Dashboard values={data.dashboard} />;
  if (tab === 'drivers') return <Drivers rows={data.drivers} open={open} mutate={mutate} />;
  if (tab === 'vehicles') return <Vehicles rows={data.vehicles} drivers={data.drivers} open={open} mutate={mutate} />;
  if (tab === 'stops') return <Stops rows={data.stops} open={open} mutate={mutate} />;
  if (tab === 'routes') return <Routes rows={data.routes} open={open} mutate={mutate} />;
  if (tab === 'schedules') return <Schedules rows={data.schedules} open={open} mutate={mutate} />;
  return <Live rows={data.live} />;
}
function Dashboard({ values }: { values: RecordData }) {
  const labels: Record<string, string> = { activeTrips: 'Active Trips', activeBuses: 'Active Buses', activeVans: 'Active Vans', driversOnActiveTrips: 'Drivers on Active Trips', gpsStale: 'GPS Stale', completedToday: 'Completed Today' };
  return <section className="metrics">{Object.entries(labels).map(([key, label]) => <article key={key}><span>{label}</span><strong>{values[key] ?? '—'}</strong></article>)}</section>;
}
function Drivers({ rows, open, mutate }: any) {
  const [search, setSearch] = useState(''); const [status, setStatus] = useState('all');
  const shown = rows.filter((row: RecordData) => `${driverName(row)} ${row.user.email} ${row.user.phone ?? ''}`.toLowerCase().includes(search.toLowerCase()) && (status === 'all' || String(row.active) === status));
  return <><Toolbar search={search} setSearch={setSearch}><select value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option><option value="true">Active</option><option value="false">Inactive</option></select><button className="primary" onClick={() => open({ kind: 'driver' })}>ADD DRIVER</button></Toolbar>{!shown.length ? <Empty text="No drivers found." action="ADD DRIVER" onClick={() => open({ kind: 'driver' })} /> : <div className="cards">{shown.map((row: RecordData) => <article className="record" key={row.id}><div><span className={statusClass(row.active)}>{row.active ? 'ACTIVE' : 'INACTIVE'}</span><h3>{driverName(row)}</h3><p>{row.user.email} · {row.user.phone || 'No mobile number'}</p><small>{row.licenseNumber ? `License ${row.licenseNumber}` : 'No license recorded'} · {row.vehicles.length} assigned vehicle(s)</small></div><div className="actions"><button onClick={() => open({ kind: 'viewDriver', item: row })}>VIEW</button><button onClick={() => open({ kind: 'driver', item: row })}>EDIT</button><button className={row.active ? 'danger' : ''} onClick={() => confirm(`${row.active ? 'Deactivate' : 'Activate'} ${driverName(row)}?`) && mutate(`/admin/drivers/${row.id}/status`, 'PATCH', { active: !row.active }, `Driver ${row.active ? 'deactivated' : 'activated'}.`)}>{row.active ? 'DEACTIVATE' : 'ACTIVATE'}</button></div></article>)}</div>}</>;
}
function Vehicles({ rows, open, mutate }: any) {
  const [search, setSearch] = useState(''); const [type, setType] = useState('all'); const [status, setStatus] = useState('all');
  const shown = rows.filter((row: RecordData) => `${row.displayName} ${row.plateNumber} ${row.bodyNumber ?? ''}`.toLowerCase().includes(search.toLowerCase()) && (type === 'all' || row.type === type) && (status === 'all' || String(row.active) === status));
  return <><Toolbar search={search} setSearch={setSearch}><select value={type} onChange={event => setType(event.target.value)}><option value="all">All types</option><option>BUS</option><option>VAN</option><option>SHUTTLE</option></select><select value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option><option value="true">Active</option><option value="false">Inactive</option></select><button className="primary" onClick={() => open({ kind: 'vehicle' })}>ADD VEHICLE</button></Toolbar>{!shown.length ? <Empty text="No vehicles found." action="ADD VEHICLE" onClick={() => open({ kind: 'vehicle' })} /> : <div className="cards">{shown.map((row: RecordData) => <article className="record" key={row.id}><div><span className={statusClass(row.active)}>{row.active ? 'ACTIVE' : 'INACTIVE'} · {row.type}</span><h3>{row.displayName}</h3><p>{row.plateNumber} · {row.bodyNumber || 'No body number'}</p><small>Driver: {driverName(row.assignedDriver)} · Capacity: {row.capacity ?? '—'}</small></div><div className="actions"><button onClick={() => open({ kind: 'vehicle', item: row })}>EDIT / ASSIGN</button><button className={row.active ? 'danger' : ''} onClick={() => confirm(`${row.active ? 'Deactivate' : 'Activate'} ${row.displayName}?`) && mutate(`/admin/vehicles/${row.id}/status`, 'PATCH', { active: !row.active }, `Vehicle ${row.active ? 'deactivated' : 'activated'}.`)}>{row.active ? 'DEACTIVATE' : 'ACTIVATE'}</button></div></article>)}</div>}</>;
}
function Stops({ rows, open, mutate }: any) {
  const [search, setSearch] = useState(''); const shown = rows.filter((row: RecordData) => `${row.name} ${row.cityMunicipality ?? ''} ${row.province ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return <><Toolbar search={search} setSearch={setSearch}><button className="primary" onClick={() => open({ kind: 'stop' })}>ADD STOP</button></Toolbar>{!shown.length ? <Empty text="No stops have been created yet." action="ADD FIRST STOP" onClick={() => open({ kind: 'stop' })} /> : <div className="cards">{shown.map((row: RecordData) => <article className="record" key={row.id}><div><span className={statusClass(row.active)}>{row.active ? 'ACTIVE' : 'INACTIVE'}</span><h3>{row.name}</h3><p>{[row.cityMunicipality, row.province].filter(Boolean).join(', ') || 'Location label not provided'}</p><small>{row.latitude.toFixed(6)}, {row.longitude.toFixed(6)}</small></div><div className="actions"><button onClick={() => open({ kind: 'stop', item: row })}>EDIT</button><button className={row.active ? 'danger' : ''} onClick={() => confirm(`${row.active ? 'Deactivate' : 'Activate'} ${row.name}?`) && mutate(`/admin/stops/${row.id}/status`, 'PATCH', { active: !row.active }, `Stop ${row.active ? 'deactivated' : 'activated'}.`)}>{row.active ? 'DEACTIVATE' : 'ACTIVATE'}</button></div></article>)}</div>}</>;
}
function Routes({ rows, open, mutate }: any) {
  const [search, setSearch] = useState(''); const shown = rows.filter((row: RecordData) => `${row.name} ${row.direction}`.toLowerCase().includes(search.toLowerCase()));
  return <><Toolbar search={search} setSearch={setSearch}><button className="primary" onClick={() => open({ kind: 'route' })}>ADD ROUTE</button></Toolbar>{!shown.length ? <Empty text="No routes have been created yet." action="ADD FIRST ROUTE" onClick={() => open({ kind: 'route' })} /> : <div className="cards">{shown.map((row: RecordData) => <article className="record route" key={row.id}><div><span className={statusClass(row.active)}>{row.active ? 'ACTIVE' : 'INACTIVE'}</span><h3>{row.name}</h3><p>{row.direction}</p><ol className="route-line">{row.stops.map((entry: RecordData) => <li key={entry.id}>{entry.stop.name}</li>)}</ol></div><div className="actions"><button onClick={() => open({ kind: 'route', item: row })}>EDIT / REORDER</button><button className={row.active ? 'danger' : ''} onClick={() => confirm(`${row.active ? 'Deactivate' : 'Activate'} ${row.name}?`) && mutate(`/admin/routes/${row.id}/status`, 'PATCH', { active: !row.active }, `Route ${row.active ? 'deactivated' : 'activated'}.`)}>{row.active ? 'DEACTIVATE' : 'ACTIVATE'}</button></div></article>)}</div>}</>;
}
function Schedules({ rows, open, mutate }: any) {
  const [search, setSearch] = useState(''); const shown = rows.filter((row: RecordData) => `${row.route.name} ${driverName(row.driver)} ${row.vehicle.displayName} ${row.trip?.status}`.toLowerCase().includes(search.toLowerCase()));
  return <><Toolbar search={search} setSearch={setSearch}><button className="primary" onClick={() => open({ kind: 'schedule' })}>CREATE SCHEDULE</button></Toolbar>{!shown.length ? <Empty text="No schedules have been created yet." action="CREATE FIRST SCHEDULE" onClick={() => open({ kind: 'schedule' })} /> : <div className="table-wrap"><table><thead><tr><th>Departure</th><th>Route</th><th>Driver</th><th>Vehicle</th><th>Trip</th><th>Action</th></tr></thead><tbody>{shown.map((row: RecordData) => <tr key={row.id}><td>{localDate(row.departureAt)}</td><td>{row.route.name}</td><td>{driverName(row.driver)}</td><td>{row.vehicle.displayName}</td><td><span className={row.trip?.status === 'ACTIVE' ? 'status good' : 'status'}>{row.trip?.status ?? 'NOT CREATED'}</span><small className="id">{row.trip?.id}</small></td><td>{row.active && ['SCHEDULED', 'READY'].includes(row.trip?.status) ? <button className="danger" onClick={() => confirm('Cancel this schedule and its generated trip?') && mutate(`/admin/schedules/${row.id}/cancel`, 'POST', undefined, 'Schedule cancelled.')}>CANCEL</button> : '—'}</td></tr>)}</tbody></table></div>}</>;
}
function Live({ rows }: { rows: RecordData[] }) {
  if (!rows.length) return <Empty text="No trips are currently active." />;
  return <div className="cards">{rows.map(row => <article className="record live-card" key={row.id}><div><span className={`status ${row.gpsStatus === 'LIVE' ? 'good' : row.gpsStatus === 'STALE' ? 'warn' : 'muted'}`}>{row.status} · GPS {row.gpsStatus}</span><h3>{row.vehicle.displayName}</h3><p>{row.route.name} · {row.route.direction}</p><small>{driverName(row.driver)} · Next: {row.nextStop?.name ?? 'Final destination'}</small></div><div className="coordinates"><strong>{row.currentLocation ? `${row.currentLocation.latitude.toFixed(5)}, ${row.currentLocation.longitude.toFixed(5)}` : 'Location unavailable'}</strong><small>Last GPS: {localDate(row.currentLocation?.recordedAt)}</small><small>ETA: unavailable</small></div></article>)}</div>;
}

function Modal({ spec, data, busy, close, mutate }: { spec: { kind: string; item?: RecordData }; data: Data; busy: boolean; close: () => void; mutate: Function }) {
  if (spec.kind === 'viewDriver') return <div className="overlay" onMouseDown={event => event.target === event.currentTarget && close()}><section className="modal"><div className="modal-head"><div><p className="kicker">DRIVER PROFILE</p><h2>{driverName(spec.item)}</h2></div><button onClick={close}>✕</button></div><dl><dt>Email</dt><dd>{spec.item?.user.email}</dd><dt>Mobile</dt><dd>{spec.item?.user.phone || '—'}</dd><dt>Status</dt><dd>{spec.item?.user.accountStatus}</dd><dt>License</dt><dd>{spec.item?.licenseNumber || '—'}</dd><dt>License expiration</dt><dd>{spec.item?.licenseExpiresAt ? new Date(spec.item.licenseExpiresAt).toLocaleDateString() : '—'}</dd><dt>Assigned vehicles</dt><dd>{spec.item?.vehicles.map((vehicle: RecordData) => vehicle.displayName).join(', ') || 'None'}</dd></dl></section></div>;
  if (spec.kind === 'route') return <RouteForm item={spec.item} stops={data.stops} busy={busy} close={close} mutate={mutate} />;
  return <EntityForm kind={spec.kind} item={spec.item} data={data} busy={busy} close={close} mutate={mutate} />;
}

function EntityForm({ kind, item, data, busy, close, mutate }: any) {
  const initial = useMemo(() => {
    if (kind === 'driver') return { email: item?.user.email ?? '', password: '', firstName: item?.firstName ?? '', middleName: item?.middleName ?? '', lastName: item?.lastName ?? '', phone: item?.user.phone ?? '', photoUrl: item?.photoUrl ?? '', licenseNumber: item?.licenseNumber ?? '', licenseExpiresAt: item?.licenseExpiresAt?.slice(0, 10) ?? '' };
    if (kind === 'vehicle') return { type: item?.type ?? 'BUS', plateNumber: item?.plateNumber ?? '', displayName: item?.displayName ?? '', bodyNumber: item?.bodyNumber ?? '', brand: item?.brand ?? '', model: item?.model ?? '', capacity: item?.capacity ?? '', assignedDriverId: item?.assignedDriverId ?? '' };
    if (kind === 'stop') return { name: item?.name ?? '', description: item?.description ?? '', cityMunicipality: item?.cityMunicipality ?? '', province: item?.province ?? '', latitude: item?.latitude ?? '', longitude: item?.longitude ?? '' };
    return { routeId: '', driverId: '', vehicleId: '', departureAt: '' };
  }, [kind, item]);
  const [form, setForm] = useState<RecordData>(initial); const set = (key: string, value: any) => setForm(current => ({ ...current, [key]: value }));
  const assignedVehicles = kind === 'schedule' ? data.vehicles.filter((vehicle: RecordData) => vehicle.active && vehicle.assignedDriverId === form.driverId) : [];
  async function submit(event: FormEvent) {
    event.preventDefault();
    const payload = { ...form };
    if (kind === 'driver') for (const key of ['middleName', 'phone', 'photoUrl', 'licenseNumber', 'licenseExpiresAt']) payload[key] = form[key] || null;
    if (kind === 'vehicle') { for (const key of ['bodyNumber', 'brand', 'model']) payload[key] = form[key] || null; payload.capacity = form.capacity === '' ? null : Number(form.capacity); payload.assignedDriverId = form.assignedDriverId || null; }
    if (kind === 'stop') { for (const key of ['description', 'cityMunicipality', 'province']) payload[key] = form[key] || null; payload.latitude = Number(form.latitude); payload.longitude = Number(form.longitude); }
    if (kind === 'schedule') payload.departureAt = new Date(form.departureAt).toISOString();
    if (kind === 'driver' && item && !form.password) delete payload.password;
    const path = kind === 'schedule' ? '/admin/schedules' : `/admin/${kind}s${item ? `/${item.id}` : ''}`;
    await mutate(path, item ? 'PATCH' : 'POST', payload, `${kind[0].toUpperCase() + kind.slice(1)} ${item ? 'updated' : 'created'}.`);
  }
  return <div className="overlay" onMouseDown={event => event.target === event.currentTarget && close()}><form className="modal" onSubmit={submit}><div className="modal-head"><div><p className="kicker">{item ? 'EDIT' : 'CREATE'}</p><h2>{kind === 'schedule' ? 'Schedule / Trip' : kind[0].toUpperCase() + kind.slice(1)}</h2></div><button type="button" onClick={close}>✕</button></div><div className="form-grid">
    {kind === 'driver' && <><Field label="First name" value={form.firstName} set={value => set('firstName', value)} required /><Field label="Middle name" value={form.middleName} set={value => set('middleName', value)} /><Field label="Last name" value={form.lastName} set={value => set('lastName', value)} required /><Field label="Email / login" type="email" value={form.email} set={value => set('email', value)} required /><Field label="Mobile number" value={form.phone} set={value => set('phone', value)} /><Field label={item ? 'New password (optional)' : 'Temporary password'} type="password" minLength={10} value={form.password} set={value => set('password', value)} required={!item} /><Field label="Photo URL" type="url" value={form.photoUrl} set={value => set('photoUrl', value)} /><Field label="License number" value={form.licenseNumber} set={value => set('licenseNumber', value)} /><Field label="License expiration" type="date" value={form.licenseExpiresAt} set={value => set('licenseExpiresAt', value)} /></>}
    {kind === 'vehicle' && <><Select label="Vehicle type" value={form.type} set={value => set('type', value)} options={['BUS', 'VAN', 'SHUTTLE']} /><Field label="Display name" value={form.displayName} set={value => set('displayName', value)} required /><Field label="Plate number" value={form.plateNumber} set={value => set('plateNumber', value)} required /><Field label="Fleet / body number" value={form.bodyNumber} set={value => set('bodyNumber', value)} /><Field label="Brand" value={form.brand} set={value => set('brand', value)} /><Field label="Model" value={form.model} set={value => set('model', value)} /><Field label="Capacity" type="number" min={1} value={form.capacity} set={value => set('capacity', value)} /><Select label="Assigned driver" value={form.assignedDriverId} set={value => set('assignedDriverId', value)} options={data.drivers.filter((driver: RecordData) => driver.active).map((driver: RecordData) => ({ value: driver.id, label: driverName(driver) }))} blank="Unassigned" /></>}
    {kind === 'stop' && <><Field label="Stop name" value={form.name} set={value => set('name', value)} required /><Field label="Description" value={form.description} set={value => set('description', value)} /><Field label="City / municipality" value={form.cityMunicipality} set={value => set('cityMunicipality', value)} /><Field label="Province" value={form.province} set={value => set('province', value)} /><Field label="Latitude" type="number" min={-90} max={90} step="any" value={form.latitude} set={value => set('latitude', value)} required /><Field label="Longitude" type="number" min={-180} max={180} step="any" value={form.longitude} set={value => set('longitude', value)} required /></>}
    {kind === 'schedule' && <><Select label="Route" value={form.routeId} set={value => set('routeId', value)} options={data.routes.filter((route: RecordData) => route.active).map((route: RecordData) => ({ value: route.id, label: `${route.name} · ${route.direction}` }))} blank="Select route" required /><Select label="Driver" value={form.driverId} set={value => { setForm(current => ({ ...current, driverId: value, vehicleId: '' })); }} options={data.drivers.filter((driver: RecordData) => driver.active).map((driver: RecordData) => ({ value: driver.id, label: driverName(driver) }))} blank="Select driver" required /><Select label="Assigned vehicle" value={form.vehicleId} set={value => set('vehicleId', value)} options={assignedVehicles.map((vehicle: RecordData) => ({ value: vehicle.id, label: `${vehicle.displayName} · ${vehicle.plateNumber}` }))} blank={form.driverId ? 'Select assigned vehicle' : 'Select a driver first'} required /><Field label="Departure date and time" type="datetime-local" value={form.departureAt} set={value => set('departureAt', value)} required /></>}
  </div><div className="modal-actions"><button type="button" onClick={close}>CANCEL</button><button className="primary" disabled={busy}>{busy ? 'SAVING…' : item ? 'SAVE CHANGES' : kind === 'schedule' ? 'CREATE READY TRIP' : 'CREATE'}</button></div></form></div>;
}

function RouteForm({ item, stops, busy, close, mutate }: any) {
  const [name, setName] = useState(item?.name ?? ''); const [direction, setDirection] = useState(item?.direction ?? '');
  const [ordered, setOrdered] = useState<RecordData[]>(item?.stops.map((entry: RecordData) => ({ stopId: entry.stopId, boardingAllowed: entry.boardingAllowed, dropoffAllowed: entry.dropoffAllowed, minutesFromPrevious: entry.minutesFromPrevious ?? '' })) ?? []);
  const activeStops = stops.filter((stop: RecordData) => stop.active); const available = activeStops.filter((stop: RecordData) => !ordered.some(entry => entry.stopId === stop.id));
  const move = (index: number, delta: number) => setOrdered(current => { const next = [...current], target = index + delta; if (target < 0 || target >= next.length) return current; [next[index], next[target]] = [next[target], next[index]]; return next; });
  async function submit(event: FormEvent) { event.preventDefault(); if (ordered.length < 2) return; const routeStops = ordered.map((entry, index) => ({ stopId: entry.stopId, sequence: index + 1, boardingAllowed: entry.boardingAllowed ?? true, dropoffAllowed: entry.dropoffAllowed ?? true, ...(entry.minutesFromPrevious === '' ? {} : { minutesFromPrevious: Number(entry.minutesFromPrevious) }) })); await mutate(`/admin/routes${item ? `/${item.id}` : ''}`, item ? 'PATCH' : 'POST', { name, direction, stops: routeStops }, `Route ${item ? 'updated' : 'created'}.`); }
  return <div className="overlay" onMouseDown={event => event.target === event.currentTarget && close()}><form className="modal wide" onSubmit={submit}><div className="modal-head"><div><p className="kicker">{item ? 'EDIT AND REORDER' : 'CREATE'}</p><h2>Route</h2></div><button type="button" onClick={close}>✕</button></div><div className="form-grid"><Field label="Route name" value={name} set={setName} required /><Field label="Direction" value={direction} set={setDirection} required /></div><div className="route-builder"><h3>Ordered stops</h3>{!ordered.length && <p className="hint">Add at least two active stops in travel order.</p>}{ordered.map((entry, index) => { const stop = stops.find((candidate: RecordData) => candidate.id === entry.stopId); return <div className="route-stop" key={entry.stopId}><strong><span>{index + 1}</span>{stop?.name}</strong><label><input type="checkbox" checked={entry.boardingAllowed ?? true} onChange={event => setOrdered(current => current.map((value, i) => i === index ? { ...value, boardingAllowed: event.target.checked } : value))} /> Board</label><label><input type="checkbox" checked={entry.dropoffAllowed ?? true} onChange={event => setOrdered(current => current.map((value, i) => i === index ? { ...value, dropoffAllowed: event.target.checked } : value))} /> Drop off</label><input aria-label="Minutes from previous" title="Minutes from previous stop" type="number" min="0" placeholder="Minutes" value={entry.minutesFromPrevious} onChange={event => setOrdered(current => current.map((value, i) => i === index ? { ...value, minutesFromPrevious: event.target.value } : value))} /><button type="button" disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" disabled={index === ordered.length - 1} onClick={() => move(index, 1)}>↓</button><button type="button" className="danger" onClick={() => setOrdered(current => current.filter((_, i) => i !== index))}>REMOVE</button></div>; })}<select value="" onChange={event => { if (event.target.value) setOrdered(current => [...current, { stopId: event.target.value, boardingAllowed: true, dropoffAllowed: true, minutesFromPrevious: '' }]); }}><option value="">Add a stop…</option>{available.map((stop: RecordData) => <option value={stop.id} key={stop.id}>{stop.name} · {stop.cityMunicipality || stop.province || 'No locality'}</option>)}</select></div>{ordered.length < 2 && <p className="alert error">A route requires at least two unique active stops.</p>}<div className="modal-actions"><button type="button" onClick={close}>CANCEL</button><button className="primary" disabled={busy || ordered.length < 2}>{busy ? 'SAVING…' : 'SAVE ROUTE'}</button></div></form></div>;
}

type FieldProps = { label: string; set: (value: string) => void; [key: string]: any };
type SelectProps = FieldProps & { options: Array<string | { value: string; label: string }>; blank?: string };
function Field({ label, set, ...props }: FieldProps) { return <label>{label}<input {...props} onChange={event => set(event.target.value)} /></label>; }
function Select({ label, set, options, blank, ...props }: SelectProps) { return <label>{label}<select {...props} onChange={event => set(event.target.value)}>{blank !== undefined && <option value="">{blank}</option>}{options.map(option => typeof option === 'string' ? <option key={option}>{option}</option> : <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>; }

createRoot(document.getElementById('root')!).render(<App />);
