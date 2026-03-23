import { Toolbar } from './components/Toolbar.jsx';
import { DataBar } from './components/DataBar.jsx';
import { Canvas } from './components/Canvas.jsx';

export default function App() {
  return (
    <div className="app-layout">
      <Toolbar />
      <DataBar />
      <Canvas />
    </div>
  );
}
