import { Routes, Route } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import ProtectedRoute from "./routes/ProtectedRoute";
import PlayerDashboard from "./pages/PlayerDashboard";
import AdminDashboard from "./pages/AdminDashboard";
import AdminGroupPage from "./pages/AdminGroupPage";
import PlayerGroupPage from "./pages/PlayerGroupPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />

      <Route
        path="/player"
        element={
          <ProtectedRoute>
            <PlayerDashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/player/group/:groupId"
        element={
          <ProtectedRoute>
            <PlayerGroupPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AdminDashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin/group/:groupId"
        element={
          <ProtectedRoute>
            <AdminGroupPage />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
