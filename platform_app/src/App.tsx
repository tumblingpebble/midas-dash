import { BrowserRouter, Route, Routes } from "react-router-dom"
import { NavBar } from "./components/NavBar"
import { RunPage } from "./pages/RunPage"
import { HistoryPage } from "./pages/HistoryPage"
import { SettingsPage } from "./pages/SettingsPage"

export default function App() {
  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-slate-950 text-slate-100">
      <BrowserRouter>
        <NavBar />
        <Routes>
          <Route path="/" element={<RunPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </BrowserRouter>
    </div>
  )
}