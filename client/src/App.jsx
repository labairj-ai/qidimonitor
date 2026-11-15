import React, { useState, useEffect, useCallback } from 'react';
import LiveFeed from './components/LiveFeed.jsx';
import ChamberLight from './components/ChamberLight.jsx';
import DiagnosePanel from './components/DiagnosePanel.jsx';
import PrintStatus from './components/PrintStatus.jsx';
import AutoMonitor from './components/AutoMonitor.jsx';
import Settings from './components/Settings.jsx';
import FileManager from './components/FileManager.jsx';
import Slicer from './components/Slicer.jsx';
import { PrinterContext } from './printerApi.jsx';

function Workspace({ config, reload, setup }) {
  const [tab, setTab] = useState(setup ? 'Settings' : 'Monitor');
  const [lastResult, setLastResult] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [reslice, setReslice] = useState(null);
  const ready = !!(config.printer_ip || config.moonraker_url);
  return <PrinterContext.Provider value={config.id}>
    <div className="workspace-heading"><div><h2>{config.name}</h2><p>{ready ? config.printer_ip || config.moonraker_url : 'Ready to set up when your printer arrives'}</p></div>
      <span className="chip">{config.model === 'u1' ? 'Four-toolhead printer' : 'QIDI'}</span></div>
    <nav className="tabs">{['Monitor','Files','Settings'].map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</nav>
    {tab === 'Monitor' && (!ready ? <div className="card setup-card"><h3>Your U1 has a place here.</h3><p>Once it arrives, save its local address, test the connection, and configure the camera. QIDI monitoring runs independently.</p><button className="btn-primary" onClick={() => setTab('Settings')}>Set up {config.name}</button></div> : <div className="detail-grid"><div className="stack"><LiveFeed config={config}/><ChamberLight config={config}/><PrintStatus config={config} onPrinterFound={reload}/><AutoMonitor config={config} onConfigChange={reload}/></div><DiagnosePanel config={config} latestResult={lastResult} onResult={setLastResult}/></div>)}
    {tab === 'Files' && <div className="detail-grid"><div>{config.model === 'qidi' ? <Slicer preloadJob={reslice} onFileUploaded={() => { setRefresh(n => n+1); setReslice(null); }}/> : <div className="card setup-card"><h3>Slice for your U1</h3><p>Use Snapmaker Orca with your U1 profile, then upload its G-code here. Built-in U1 slicing will be enabled after its machine and toolhead profiles are verified.</p><p>{config.controls_enabled !== '1' ? 'Uploads and print controls unlock in Settings after you verify this printer.' : 'Uploads and controls are enabled for this printer.'}</p></div>}</div><FileManager printerName={config.name} refreshKey={refresh} onReslice={config.model === 'qidi' ? setReslice : undefined}/></div>}
    {tab === 'Settings' && <Settings config={config} onSave={reload}/>}
  </PrinterContext.Provider>;
}
function PrinterCard({ config, open, reload }) {
  const ready = !!(config.printer_ip || config.moonraker_url);
  return <PrinterContext.Provider value={config.id}><section className="printer-card"><div className="card-heading"><div><span className="eyebrow">{config.model === 'u1' ? 'SNAPMAKER · U1' : 'QIDI · X-PLUS 3'}</span><h2>{config.name}</h2></div><button className="btn-ghost" onClick={open}>{ready ? 'Open printer →' : 'Set up →'}</button></div>
    {ready ? <div className="stack"><LiveFeed config={config}/><ChamberLight config={config}/><PrintStatus config={config} onPrinterFound={reload}/><AutoMonitor config={config} onConfigChange={reload}/></div> : <div className="card arrival-card"><div className="arrival-icon">＋</div><h3>Ready when it arrives</h3><p>Your U1 workspace is prepared. Add its address and camera to bring it online alongside your QIDI.</p><div className="setup-steps"><span>01 · Connect printer</span><span>02 · Check camera</span><span>03 · Start monitoring</span></div><button className="btn-primary" onClick={open}>Prepare U1 setup</button></div>}</section></PrinterContext.Provider>;
}
export default function App() {
  const [printers, setPrinters] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try { const r = await fetch('/api/printers'); if (!r.ok) throw new Error('Unable to load printers'); setPrinters(await r.json()); setError(''); }
    catch(e) { setError(e.message); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const printer = printers.find(p => p.id === selected);
  return <div className="app"><header className="app-header"><div><span className="eyebrow">YOUR PRINT ROOM</span><h1>QIDI Monitor<span className="header-dot"> / </span><span className="header-subtitle">Printers</span></h1></div><span className="fleet-count">{printers.length} printers</span></header>
    <main className="app-main"><div className="printer-nav"><button className={!selected ? 'btn-primary' : 'btn-ghost'} onClick={() => setSelected(null)}>All printers</button>{printers.map(p => <button key={p.id} className={selected === p.id ? 'btn-primary' : 'btn-ghost'} onClick={() => setSelected(p.id)}>{p.name}</button>)}</div>
    {error && <p role="alert">{error} <button onClick={reload}>Retry</button></p>}
    {!printers.length && !error && <p>Loading your printers…</p>}
    {printer ? <Workspace key={printer.id} config={printer} reload={reload} setup={!printer.printer_ip && !printer.moonraker_url}/> : <><div className="overview-heading"><h2>Both printers. One view.</h2><p>Independent cameras, progress, and monitoring for every print.</p></div><div className="fleet-grid">{printers.map(p => <PrinterCard key={p.id} config={p} reload={reload} open={() => setSelected(p.id)}/>)}</div></>}
    </main></div>;
}
