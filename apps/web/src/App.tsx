import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivateRoute } from "./router/PrivateRoute";
import { RoleGuard } from "./router/RoleGuard";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./hooks/useToast";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 120_000 } },
});

// ─── Layouts ──────────────────────────────────────────────────
const AuthLayout      = lazy(() => import("./pages/auth/AuthLayout"));
const DashboardLayout = lazy(() => import("./pages/dashboard/DashboardLayout"));
const SettingsLayout  = lazy(() => import("./pages/dashboard/settings/SettingsLayout"));

// ─── Public ───────────────────────────────────────────────────
const LandingPage       = lazy(() => import("./pages/LandingPage"));
const NotFoundPage      = lazy(() => import("./pages/NotFoundPage"));

// ─── Auth ─────────────────────────────────────────────────────
const LoginPage         = lazy(() => import("./pages/auth/LoginPage"));
const RegisterPage      = lazy(() => import("./pages/auth/RegisterPage"));
const ForgotPasswordPage = lazy(() => import("./pages/auth/ForgotPasswordPage"));

// ─── Dashboard ────────────────────────────────────────────────
const DashboardHomePage   = lazy(() => import("./pages/dashboard/HomePage"));
const BillingPage         = lazy(() => import("./pages/dashboard/BillingPage"));
const BillingNewPage      = lazy(() => import("./pages/dashboard/BillingNewPage"));
const BillingDraftsPage   = lazy(() => import("./pages/dashboard/BillingDraftsPage"));
const BillingReturnsPage  = lazy(() => import("./pages/dashboard/BillingReturnsPage"));
const BillingDetailPage   = lazy(() => import("./pages/dashboard/BillingDetailPage"));
const BillingReturnPage   = lazy(() => import("./pages/dashboard/BillingReturnPage"));
const InventoryPage       = lazy(() => import("./pages/dashboard/InventoryPage"));
const MedicinesPage       = lazy(() => import("./pages/dashboard/MedicinesPage"));
const PurchasePage        = lazy(() => import("./pages/dashboard/PurchasePage"));
const SuppliersPage       = lazy(() => import("./pages/dashboard/SuppliersPage"));
const ReportsPage         = lazy(() => import("./pages/dashboard/ReportsPage"));
const StaffPage           = lazy(() => import("./pages/dashboard/StaffPage"));
const GinniPage           = lazy(() => import("./pages/dashboard/GinniPage"));
const IntegrationPage     = lazy(() => import("./pages/dashboard/IntegrationPage"));
const LocationsPage       = lazy(() => import("./pages/dashboard/LocationsPage"));
const StockAuditPage      = lazy(() => import("./pages/dashboard/StockAuditPage"));
const StockAuditDetailPage = lazy(() => import("./pages/dashboard/StockAuditDetailPage"));
const CalendarPage         = lazy(() => import("./pages/dashboard/CalendarPage"));
const CustomersPage        = lazy(() => import("./pages/dashboard/CustomersPage"));
const QuotationsPage       = lazy(() => import("./pages/dashboard/QuotationsPage"));
const DoctorsPage          = lazy(() => import("./pages/dashboard/DoctorsPage"));
const CashClosurePage      = lazy(() => import("./pages/dashboard/CashClosurePage"));
const PrescriptionsPage    = lazy(() => import("./pages/dashboard/PrescriptionsPage"));
const MigrationPage        = lazy(() => import("./pages/dashboard/MigrationPage"));

// ─── Support ──────────────────────────────────────────────────
const SupportTicketsPage   = lazy(() => import("./pages/dashboard/support/SupportTicketsPage"));
const TicketDetailPage     = lazy(() => import("./pages/dashboard/support/TicketDetailPage"));
const AgentsPage           = lazy(() => import("./pages/dashboard/support/AgentsPage"));

// ─── Settings ─────────────────────────────────────────────────
const SettingsPage           = lazy(() => import("./pages/dashboard/settings/SettingsPage"));
const PharmacyProfilePage    = lazy(() => import("./pages/dashboard/settings/PharmacyProfilePage"));
const DocumentsPage          = lazy(() => import("./pages/dashboard/settings/DocumentsPage"));
const StaffSettingsPage      = lazy(() => import("./pages/dashboard/settings/StaffSettingsPage"));
const PlansPage              = lazy(() => import("./pages/dashboard/settings/PlansPage"));
const ChangePasswordPage     = lazy(() => import("./pages/dashboard/settings/ChangePasswordPage"));
const InvoiceSettingsPage    = lazy(() => import("./pages/dashboard/settings/InvoiceSettingsPage"));
const BillingPreferencesPage = lazy(() => import("./pages/dashboard/settings/BillingPreferencesPage"));
const MyProfilePage          = lazy(() => import("./pages/dashboard/settings/MyProfilePage"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-screen bg-surface-secondary">
      <div className="w-8 h-8 rounded-full border-2 border-brand-200 border-t-brand-600 animate-spin" />
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
    <ToastProvider>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Landing */}
          <Route path="/" element={<LandingPage />} />

          {/* Auth routes */}
          <Route element={<AuthLayout />}>
            <Route path="/login"           element={<LoginPage />} />
            <Route path="/register"        element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          </Route>

          {/* Protected dashboard routes */}
          <Route element={<PrivateRoute />}>
            {/* ErrorBoundary wraps DashboardLayout so any uncaught render error in
                any dashboard page shows a recovery UI instead of a blank screen. */}
            <Route element={<ErrorBoundary><DashboardLayout /></ErrorBoundary>}>
              <Route path="/dashboard"                       element={<DashboardHomePage />} />
              <Route path="/dashboard/billing"               element={<BillingPage />} />
              <Route path="/dashboard/billing/new"           element={<BillingNewPage />} />
              <Route path="/dashboard/billing/drafts"        element={<BillingDraftsPage />} />
              <Route path="/dashboard/billing/returns"       element={<BillingReturnsPage />} />
              <Route path="/dashboard/billing/:id"           element={<BillingDetailPage />} />
              <Route path="/dashboard/billing/:id/return"    element={<BillingReturnPage />} />
              <Route path="/dashboard/inventory"             element={<InventoryPage />} />
              <Route path="/dashboard/medicines"             element={<MedicinesPage />} />
              <Route path="/dashboard/purchase"              element={<PurchasePage />} />
              <Route path="/dashboard/suppliers"             element={<SuppliersPage />} />

              {/* Reports: owners + managers only (financial data) */}
              <Route element={<RoleGuard allow={["OWNER", "MANAGER"]} redirectTo="/dashboard" />}>
                <Route path="/dashboard/reports"             element={<ReportsPage />} />
              </Route>

              <Route element={<RoleGuard allow={["OWNER", "MANAGER"]} redirectTo="/dashboard" />}>
                <Route path="/dashboard/staff"               element={<StaffPage />} />
              </Route>
              <Route path="/dashboard/ginni"                 element={<GinniPage />} />

              {/* Integration + Locations: owner/manager setup pages */}
              <Route element={<RoleGuard allow={["OWNER", "MANAGER"]} redirectTo="/dashboard" />}>
                <Route path="/dashboard/integration"         element={<IntegrationPage />} />
                <Route path="/dashboard/locations"           element={<LocationsPage />} />
              </Route>
              <Route path="/dashboard/stock-audit"           element={<StockAuditPage />} />
              <Route path="/dashboard/stock-audit/:id"       element={<StockAuditDetailPage />} />
              <Route path="/dashboard/calendar"              element={<CalendarPage />} />
              <Route path="/dashboard/customers"            element={<CustomersPage />} />
              <Route path="/dashboard/quotations"           element={<QuotationsPage />} />
              <Route path="/dashboard/doctors"              element={<DoctorsPage />} />
              <Route path="/dashboard/prescriptions"       element={<PrescriptionsPage />} />

              {/* Owner/Manager only routes */}
              <Route element={<RoleGuard allow={["OWNER", "MANAGER"]} />}>
                <Route path="/dashboard/cash-closure"       element={<CashClosurePage />} />
              </Route>

              {/* Migration: OWNER only — touches global catalog + financial opening balances */}
              <Route element={<RoleGuard allow={["OWNER"]} redirectTo="/dashboard" />}>
                <Route path="/dashboard/migration"          element={<MigrationPage />} />
              </Route>

              {/* Support — static routes must come before the dynamic :id segment */}
              <Route path="/dashboard/support"              element={<SupportTicketsPage />} />
              <Route path="/dashboard/support/agents"       element={<AgentsPage />} />
              <Route path="/dashboard/support/:id"          element={<TicketDetailPage />} />

              {/* Settings nested layout — pharmacy-profile and change-password open to all;
                  everything else is owner/manager only */}
              <Route element={<SettingsLayout />}>
                <Route path="/dashboard/settings" element={<Navigate to="/dashboard/settings/my-profile" replace />} />
                <Route path="/dashboard/settings/my-profile"       element={<MyProfilePage />} />
                <Route path="/dashboard/settings/pharmacy-profile" element={<PharmacyProfilePage />} />
                <Route path="/dashboard/settings/change-password"  element={<ChangePasswordPage />} />

                <Route element={<RoleGuard allow={["OWNER", "MANAGER"]} redirectTo="/dashboard/settings/pharmacy-profile" />}>
                  <Route path="/dashboard/settings/documents" element={<DocumentsPage />} />
                  <Route path="/dashboard/settings/staff"     element={<StaffSettingsPage />} />
                  <Route path="/dashboard/settings/plans"     element={<PlansPage />} />
                  <Route path="/dashboard/settings/invoice"   element={<InvoiceSettingsPage />} />
                  <Route path="/dashboard/settings/billing"   element={<BillingPreferencesPage />} />
                </Route>
              </Route>
            </Route>
          </Route>

          {/* 404 */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
    </ToastProvider>
    </QueryClientProvider>
  );
}
