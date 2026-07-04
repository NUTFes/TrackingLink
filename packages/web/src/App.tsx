import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { AuthProvider } from './components/AuthProvider';
import { ProtectedRoute } from './components/ProtectedRoute';
import CreateProjectPage from './pages/CreateProjectPage';
import { LoginPage } from './pages/LoginPage';
import ManageProjectsPage from './pages/ManageProjectsPage';
import ProjectAnalyticsPage from './pages/ProjectAnalyticsPage';
import QRCodesPage from './pages/QRCodesPage';

export default function App() {
	return (
		<BrowserRouter>
			<AuthProvider>
				<Routes>
					<Route path="/login" element={<LoginPage />} />
					<Route path="/" element={<Navigate to="/links" replace />} />
					<Route
						path="/links"
						element={
							<ProtectedRoute>
								<AppLayout>
									<ManageProjectsPage />
								</AppLayout>
							</ProtectedRoute>
						}
					/>
					<Route
						path="/links/create"
						element={
							<ProtectedRoute>
								<AppLayout>
									<CreateProjectPage />
								</AppLayout>
							</ProtectedRoute>
						}
					/>
					<Route
						path="/links/:id/qrcodes"
						element={
							<ProtectedRoute>
								<AppLayout>
									<QRCodesPage />
								</AppLayout>
							</ProtectedRoute>
						}
					/>
					<Route
						path="/links/:id/analytics"
						element={
							<ProtectedRoute>
								<AppLayout>
									<ProjectAnalyticsPage />
								</AppLayout>
							</ProtectedRoute>
						}
					/>
				</Routes>
			</AuthProvider>
		</BrowserRouter>
	);
}
