import { Link, Route, Routes } from 'react-router-dom';
import HomePage from './pages/HomePage';

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-800 px-6 py-3 flex gap-6 items-center">
        <Link to="/" className="font-semibold">PlaySync</Link>
      </header>
      <main className="p-6">
        <Routes>
          <Route path="/" element={<HomePage />} />
        </Routes>
      </main>
    </div>
  );
}
