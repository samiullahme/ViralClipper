// src/App.jsx — app shell: router, sidebar layout, lazy-loaded pages.
import React, { Suspense, lazy } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from './context/AppContext.jsx';
import Sidebar from './components/Sidebar.jsx';

// Lazy pages keep the initial bundle small (fast startup on weak hardware).
const Home = lazy(() => import('./pages/Home.jsx'));
const Transcribe = lazy(() => import('./pages/Transcribe.jsx'));
const Clips = lazy(() => import('./pages/Clips.jsx'));
const Editor = lazy(() => import('./pages/Editor.jsx'));
const Export = lazy(() => import('./pages/Export.jsx'));
const Settings = lazy(() => import('./components/Settings.jsx'));

/** Full-page skeleton shown while a lazy chunk downloads. */
function PageSkeleton() {
  return (
    <div className="p-8 space-y-4">
      <div className="skeleton h-8 w-64" />
      <div className="skeleton h-40 w-full" />
      <div className="grid grid-cols-3 gap-4">
        <div className="skeleton h-32" />
        <div className="skeleton h-32" />
        <div className="skeleton h-32" />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AppProvider>
        <div className="flex h-full">
          <Sidebar />
          <main className="flex-1 overflow-y-auto min-w-0">
            <Suspense fallback={<PageSkeleton />}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/transcribe" element={<Transcribe />} />
                <Route path="/clips" element={<Clips />} />
                <Route path="/editor" element={<Editor />} />
                <Route path="/export" element={<Export />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<Home />} />
              </Routes>
            </Suspense>
          </main>
        </div>
      </AppProvider>
    </HashRouter>
  );
}
