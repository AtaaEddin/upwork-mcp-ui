import { Route, Routes } from 'react-router';
import { AccountProvider } from './context/account.js';
import { AuthProvider } from './context/auth.js';
import { Layout } from './components/Layout.js';
import { RequireAuth } from './components/RequireAuth.js';
import { LoginPage } from './pages/LoginPage.js';
import { ToolsPage } from './pages/ToolsPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { JobsPage } from './pages/JobsPage.js';
import { JobDetailPage } from './pages/JobDetailPage.js';
import { ProposalsPage } from './pages/ProposalsPage.js';
import { ProposalDraftPage } from './pages/ProposalDraftPage.js';
import { InvitationsPage } from './pages/InvitationsPage.js';
import { ContractsPage, MessagesPage, NotFoundPage, ProfilePage } from './pages/sections.js';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              {/* Plan 06: the selected account (org_uid) feeds every feature call. */}
              <AccountProvider>
                <Layout />
              </AccountProvider>
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="jobs/:jobKey" element={<JobDetailPage />} />
          <Route path="jobs/:jobKey/propose" element={<ProposalDraftPage />} />
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
