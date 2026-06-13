import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import NewOrder from './pages/NewOrder';
import OrderDetail from './pages/OrderDetail';
import MyOrders from './pages/MyOrders';
import OrderFeed from './pages/OrderFeed';
import Applications from './pages/Applications';
import AppliedOrders from './pages/AppliedOrders';
import Chat from './pages/Chat';
import Support from './pages/Support';
import SupportChat from './pages/SupportChat';
import Admin from './pages/Admin';
import AdminSettings from './pages/AdminSettings';
import AdminChatModeration from './pages/AdminChatModeration';
import AdminLedger from './pages/AdminLedger';
import AdminDisputes from './pages/AdminDisputes';
import AdminSupport from './pages/AdminSupport';
import AdminUsers from './pages/AdminUsers';
import AdminDeposits from './pages/AdminDeposits';
import AdminWithdrawals from './pages/AdminWithdrawals';
import AdminContactExchange from './pages/AdminContactExchange';
import AdminOrders from './pages/AdminOrders';
import AdminConversations from './pages/AdminConversations';
import AdminLayout from './components/AdminLayout';
import ServicesCatalog from './pages/ServicesCatalog';
import ServiceDetail from './pages/ServiceDetail';
import ServiceNew from './pages/ServiceNew';
import ServiceEdit from './pages/ServiceEdit';
import ServicesMine from './pages/ServicesMine';
import Wallet from './pages/Wallet';
import UserProfile from './pages/UserProfile';
import NotFound from './pages/NotFound';

function AdminGuard() {
  const { user, profile, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile?.is_admin) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/" element={<Layout />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="orders" element={<OrderFeed />} />
              <Route path="orders/new" element={<NewOrder />} />
              <Route path="orders/mine" element={<MyOrders />} />
              <Route path="orders/applied" element={<AppliedOrders />} />
              <Route path="orders/:id" element={<OrderDetail />} />
              <Route path="orders/:id/applications" element={<Applications />} />
              <Route path="orders/:id/chat" element={<Chat />} />
              <Route path="support" element={<Support />} />
              <Route path="support/:id" element={<SupportChat />} />
              <Route path="users/:id" element={<UserProfile />} />
              <Route path="wallet" element={<Wallet />} />
              <Route path="services" element={<ServicesCatalog />} />
              <Route path="services/new" element={<ServiceNew />} />
              <Route path="services/mine" element={<ServicesMine />} />
              <Route path="services/:id" element={<ServiceDetail />} />
              <Route path="services/:id/edit" element={<ServiceEdit />} />
              <Route element={<AdminGuard />}>
                <Route element={<AdminLayout />}>
                  <Route path="admin" element={<Admin />} />
                  <Route path="admin/ledger" element={<AdminLedger />} />
                  <Route path="admin/settings" element={<AdminSettings />} />
                  <Route path="admin/chat-moderation" element={<AdminChatModeration />} />
                  <Route path="admin/disputes" element={<AdminDisputes />} />
                  <Route path="admin/support" element={<AdminSupport />} />
                  <Route path="admin/users" element={<AdminUsers />} />
                  <Route path="admin/deposits" element={<AdminDeposits />} />
                  <Route path="admin/withdrawals" element={<AdminWithdrawals />} />
                  <Route path="admin/contact-exchange-orders" element={<AdminContactExchange />} />
                  <Route path="admin/orders" element={<AdminOrders />} />
                  <Route path="admin/conversations" element={<AdminConversations />} />
                </Route>
              </Route>
              <Route path="*" element={<NotFound />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
