import { Navigate, Route, Routes } from "react-router-dom";
import { BrowsePage } from "./pages/BrowsePage";
import { SimulatorPage } from "./pages/SimulatorPage";

export function App() {
  return (
    <>
      <main className="container">
        <Routes>
          <Route path="/" element={<Navigate to="/cards" replace />} />
          <Route path="/cards" element={<BrowsePage />} />
          <Route path="/simulator" element={<SimulatorPage />} />
        </Routes>
      </main>
    </>
  );
}
