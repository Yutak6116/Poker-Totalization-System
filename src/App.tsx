import { Routes, Route } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import SuccessPage from "./pages/SuccessPage";
import ProtectedRoute from "./routes/ProtectedRoute";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route
        path="/success"
        element={
          <ProtectedRoute>
            <SuccessPage />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
