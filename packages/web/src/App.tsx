import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { AuthProvider } from './components/AuthProvider';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ToastProvider } from './components/ToastProvider';
import { LocaleProvider } from './lib/i18n';
import CreateProjectPage from './pages/CreateProjectPage';
import { LoginPage } from './pages/LoginPage';
import ManageProjectsPage from './pages/ManageProjectsPage';
import QRCodesPage from './pages/QRCodesPage';

/**
 * Provider order is load-bearing:
 *  - ToastProvider below LocaleProvider, so toasts can translate their labels.
 *  - ToastProvider above AuthProvider, whose 401 handling raises a toast.
 *  - ToastProvider above Routes, so a success toast fired immediately before
 *    `navigate('/links')` survives the navigation. That is exactly what "project
 *    created" needs, and the reason a page-local banner could never deliver it.
 */
export default function App() {
	return (
		<LocaleProvider>
			<ToastProvider>
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
						</Routes>
					</AuthProvider>
				</BrowserRouter>
			</ToastProvider>
		</LocaleProvider>
	);
}
