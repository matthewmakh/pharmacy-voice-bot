import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/layout/Layout';
import Dashboard from './pages/Dashboard';
import NewCase from './pages/NewCase';
import CaseDetail from './pages/CaseDetail';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="cases/new" element={<NewCase />} />
          <Route path="cases/:id" element={<CaseDetail />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
