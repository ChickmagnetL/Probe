import { HashRouter, Routes, Route } from "react-router-dom";
import { AppView } from "./views/AppView";
import { ImportModal } from "./components/shared/ImportModal";

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="*" element={<AppView />} />
      </Routes>
      <ImportModal />
    </HashRouter>
  );
}

export default App;
