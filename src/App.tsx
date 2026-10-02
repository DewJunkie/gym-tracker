import { useCallback, useEffect, useState } from 'react';
import {
  createGym,
  dbReady,
  findMachineByNumber,
  findMachineByQr,
  listGyms,
  listPseudoMachines,
  updateGym,
} from './db/client';
import type { Gym, Machine } from './db/types';
import Home from './pages/Home';
import ScannerView from './pages/ScannerView';
import OcrView from './pages/OcrView';
import MachineView from './pages/MachineView';
import Registry from './pages/Registry';
import History from './pages/History';
import Export from './pages/Export';

type View =
  | { name: 'home' }
  | { name: 'scan' }
  | { name: 'ocr' }
  | { name: 'machine'; machineId: string }
  | { name: 'machines'; prefill?: { qrPayload?: string; machineNumber?: string } }
  | { name: 'history' }
  | { name: 'export' };

type Tab = 'home' | 'machines' | 'history' | 'export';

const GYM_KEY = 'gymtracker.gymId';

export default function App() {
  const [view, setView] = useState<View>({ name: 'home' });
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [gymId, setGymId] = useState<string | null>(() => localStorage.getItem(GYM_KEY));
  const [pseudoMachines, setPseudoMachines] = useState<Machine[]>([]);
  const [dbState, setDbState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [dbError, setDbError] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    dbReady()
      .then(async () => {
        const g = await listGyms();
        setGyms(g);
        setGymId((prev) => {
          if (prev && g.some((x) => x.id === prev)) return prev;
          const fallback = g[0]?.id ?? null;
          if (fallback) localStorage.setItem(GYM_KEY, fallback);
          return fallback;
        });
        setDbState('ready');
      })
      .catch((e: unknown) => {
        setDbError(e instanceof Error ? e.message : String(e));
        setDbState('error');
      });
  }, []);

  // Pseudo-machines ("Free weights", "Cable station") for the no-scan flow.
  useEffect(() => {
    if (dbState === 'ready' && gymId) {
      listPseudoMachines(gymId)
        .then(setPseudoMachines)
        .catch(() => setPseudoMachines([]));
    } else {
      setPseudoMachines([]);
    }
  }, [dbState, gymId]);

  const selectGym = (id: string) => {
    setGymId(id);
    localStorage.setItem(GYM_KEY, id);
  };

  const addGym = async (name: string) => {
    const g = await createGym(name);
    setGyms((prev) => [...prev, g].sort((a, b) => a.name.localeCompare(b.name)));
    selectGym(g.id);
  };

  const renameGym = async (id: string, name: string) => {
    const g = await updateGym(id, name);
    setGyms((prev) =>
      prev.map((x) => (x.id === g.id ? g : x)).sort((a, b) => a.name.localeCompare(b.name)),
    );
  };

  const goTab = (tab: Tab) => {
    setNotice(null);
    setView(
      tab === 'home'
        ? { name: 'home' }
        : tab === 'machines'
          ? { name: 'machines' }
          : tab === 'history'
            ? { name: 'history' }
            : { name: 'export' },
    );
  };

  const handleScanResult = useCallback(
    async (payload: string) => {
      if (!gymId) return;
      const machine = await findMachineByQr(gymId, payload);
      if (machine) {
        setView({ name: 'machine', machineId: machine.id });
      } else {
        setNotice('That QR code isn\u2019t registered at this gym yet.');
        setView({ name: 'machines', prefill: { qrPayload: payload } });
      }
    },
    [gymId],
  );

  const handleMachineNumber = useCallback(
    async (num: string) => {
      if (!gymId) return;
      const machine = await findMachineByNumber(gymId, num);
      if (machine) {
        setView({ name: 'machine', machineId: machine.id });
      } else {
        setNotice(`Machine #${num} isn\u2019t registered at this gym yet.`);
        setView({ name: 'machines', prefill: { machineNumber: num } });
      }
    },
    [gymId],
  );

  if (dbState === 'loading') {
    return (
      <div className="page boot">
        <h1>Gym Tracker</h1>
        <p className="muted">Opening your database…</p>
      </div>
    );
  }

  if (dbState === 'error') {
    return (
      <div className="page boot">
        <h1>Gym Tracker</h1>
        <div className="error">Couldn&apos;t open the local database: {dbError}</div>
        <p className="muted">
          This app needs WebAssembly, Web Workers, and the Origin Private File System — try a
          recent Chrome, Edge, Safari, or Firefox over HTTPS or localhost.
        </p>
      </div>
    );
  }

  const activeTab: Tab =
    view.name === 'machine' || view.name === 'scan' || view.name === 'ocr'
      ? 'home'
      : view.name === 'machines'
        ? 'machines'
        : view.name;

  return (
    <div className="app">
      <main>
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button className="link" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        )}
        {view.name === 'home' && (
          <Home
            gyms={gyms}
            gymId={gymId}
            onSelectGym={selectGym}
            onAddGym={addGym}
            onRenameGym={renameGym}
            onScan={() => setView({ name: 'scan' })}
            onOcr={() => setView({ name: 'ocr' })}
            onMachineNumber={(num) => void handleMachineNumber(num)}
            pseudoMachines={pseudoMachines}
            onOpenMachine={(id) => setView({ name: 'machine', machineId: id })}
          />
        )}
        {view.name === 'scan' && (
          <ScannerView
            onScan={(p) => void handleScanResult(p)}
            onCancel={() => setView({ name: 'home' })}
          />
        )}
        {view.name === 'ocr' && (
          <OcrView
            onResult={(digits) => void handleMachineNumber(digits)}
            onCancel={() => setView({ name: 'home' })}
          />
        )}
        {view.name === 'machine' && (
          <MachineView machineId={view.machineId} onBack={() => setView({ name: 'home' })} />
        )}
        {view.name === 'machines' && gymId && (
          <Registry
            key={view.prefill ? `prefill-${view.prefill.qrPayload ?? view.prefill.machineNumber}` : 'list'}
            gymId={gymId}
            prefill={view.prefill}
            onOpenMachine={(id) => setView({ name: 'machine', machineId: id })}
          />
        )}
        {view.name === 'history' && <History />}
        {view.name === 'export' && <Export />}
      </main>
      <nav className="tabbar">
        {(
          [
            ['home', 'Home'],
            ['machines', 'Machines'],
            ['history', 'History'],
            ['export', 'Export'],
          ] as [Tab, string][]
        ).map(([tab, label]) => (
          <button
            key={tab}
            className={activeTab === tab ? 'active' : ''}
            onClick={() => goTab(tab)}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
