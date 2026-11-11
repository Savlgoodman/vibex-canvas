import { useState, useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { TaskListPanel } from './components/TaskList/TaskListPanel';
import { Workspace } from './components/Workspace/Workspace';
import { SettingsModal } from './components/Settings/SettingsModal';
import { useStore, initFromBridge } from './store/useStore';

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const addTask = useStore((s) => s.addTask);

  // Load state from VibeX Host bridge, or auto-create first task
  useEffect(() => {
    initFromBridge().then(() => {
      if (useStore.getState().tasks.length === 0) {
        addTask();
      }
    });
  }, []);

  return (
    <div className="app">
      <TopBar onOpenSettings={() => setSettingsOpen(true)} />
      <div className="app-body">
        <div className="app-sidebar">
          <TaskListPanel />
        </div>
        <Workspace />
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
