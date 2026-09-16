import { Route, Routes } from 'react-router-dom';
import HomePage from './pages/public/HomePage';
import ReadPage from './pages/public/ReadPage';
import SurveyReturnPage from './pages/public/SurveyReturnPage';
import NotFoundPage from './pages/public/NotFoundPage';
import LoginPage from './pages/admin/LoginPage';
import AdminLayout, { RequirePermission } from './pages/admin/AdminLayout';
import DashboardPage from './pages/admin/DashboardPage';
import BatchesPage from './pages/admin/BatchesPage';
import BatchDetailPage from './pages/admin/BatchDetailPage';
import CouponsPage from './pages/admin/CouponsPage';
import SurveysPage from './pages/admin/SurveysPage';
import ResponsesPage from './pages/admin/ResponsesPage';
import EventsPage from './pages/admin/EventsPage';
import AccessPage from './pages/admin/AccessPage';
import { PERMISSIONS } from './lib/permissions';

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
        <Route
          index
          element={
            <RequirePermission permission={PERMISSIONS.DASHBOARD_VIEW}>
              <DashboardPage />
            </RequirePermission>
          }
        />
        <Route
          path="batches"
          element={
            <RequirePermission permission={PERMISSIONS.BATCHES_VIEW}>
              <BatchesPage />
            </RequirePermission>
          }
        />
        <Route
          path="batches/:id"
          element={
            <RequirePermission permission={PERMISSIONS.BATCHES_VIEW}>
              <BatchDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="coupons"
          element={
            <RequirePermission permission={PERMISSIONS.COUPONS_VIEW}>
              <CouponsPage />
            </RequirePermission>
          }
        />
        <Route
          path="surveys"
          element={
            <RequirePermission permission={PERMISSIONS.SURVEYS_VIEW}>
              <SurveysPage />
            </RequirePermission>
          }
        />
        <Route
          path="responses"
          element={
            <RequirePermission permission={PERMISSIONS.RESPONSES_VIEW}>
              <ResponsesPage />
            </RequirePermission>
          }
        />
        <Route
          path="events"
          element={
            <RequirePermission permission={PERMISSIONS.EVENTS_VIEW}>
              <EventsPage />
            </RequirePermission>
          }
        />
        <Route
          path="access"
          element={
            <RequirePermission permission={PERMISSIONS.ROLES_VIEW}>
              <AccessPage />
            </RequirePermission>
          }
        />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
