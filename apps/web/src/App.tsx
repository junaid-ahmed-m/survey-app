import { Route, Routes } from 'react-router-dom';
import HomePage from './pages/public/HomePage';
import ReadPage from './pages/public/ReadPage';
import SurveyReturnPage from './pages/public/SurveyReturnPage';
import NotFoundPage from './pages/public/NotFoundPage';
import LoginPage from './pages/admin/LoginPage';
import AdminLayout from './pages/admin/AdminLayout';
import DashboardPage from './pages/admin/DashboardPage';
import BatchesPage from './pages/admin/BatchesPage';
import BatchDetailPage from './pages/admin/BatchDetailPage';
import CouponsPage from './pages/admin/CouponsPage';
import SurveysPage from './pages/admin/SurveysPage';
import ResponsesPage from './pages/admin/ResponsesPage';

export default function App() {
  return (
    <Routes>
      {/* Public app - opened by the native camera from the QR code */}
      <Route path="/" element={<HomePage />} />
      <Route path="/read/:code" element={<ReadPage />} />
      <Route path="/survey/return" element={<SurveyReturnPage />} />

      {/* Admin portal - same FE + BE app */}
      <Route path="/admin/login" element={<LoginPage />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="batches" element={<BatchesPage />} />
        <Route path="batches/:id" element={<BatchDetailPage />} />
        <Route path="coupons" element={<CouponsPage />} />
        <Route path="surveys" element={<SurveysPage />} />
        <Route path="responses" element={<ResponsesPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
