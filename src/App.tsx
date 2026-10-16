import { useState, useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { TaskListPanel } from './components/TaskList/TaskListPanel';
import { Workspace } from './components/Workspace/Workspace';
import { SettingsModal } from './components/Settings/SettingsModal';
import { useStore } from './store/useStore';
import './App.css';

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const addTask = useStore((s) => s.addTask);
  const tasks = useStore((s) => s.tasks);

  // Auto-create first task if none exist
  useEffect(() => {
    if (tasks.length === 0) {
      addTask();
    }
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
