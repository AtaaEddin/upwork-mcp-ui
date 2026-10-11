import { Route, Routes } from 'react-router';
import { AuthProvider } from './context/auth.js';
import { Layout } from './components/Layout.js';
import { RequireAuth } from './components/RequireAuth.js';
import { LoginPage } from './pages/LoginPage.js';
import { ToolsPage } from './pages/ToolsPage.js';
import {
  ContractsPage,
  DashboardPage,
  InvitationsPage,
  JobsPage,
  MessagesPage,
  NotFoundPage,
  ProfilePage,
  ProposalsPage,
} from './pages/sections.js';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="proposals" element={<ProposalsPage />} />
          <Route path="invitations" element={<InvitationsPage />} />
          <Route path="messages" element={<MessagesPage />} />
          <Route path="contracts" element={<ContractsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="tools" element={<ToolsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
