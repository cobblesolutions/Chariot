import { type ReactNode } from "react";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DocumentPreviewHost } from "@/components/document-preview";
import NotFound from "@/pages/not-found";
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
  Redirect,
} from "wouter";

import { queryClient } from "./lib/queryClient";
import { installNavHistory } from "./lib/nav-history";
import { QueryClientProvider } from "@tanstack/react-query";

import Shell from "./components/layout/shell";
import Dashboard from "./pages/dashboard";
import ActivityPage from "./pages/activity";
import ClientsList from "./pages/clients";
import ClientDetail from "./pages/client-detail";
import CasesList from "./pages/cases";
import CaseDetail from "./pages/case-detail";
import TasksList from "./pages/tasks";
import LendersList from "./pages/lenders";
import LenderDetail from "./pages/lender-detail";
import PropertiesList from "./pages/properties";
import PropertyDetail from "./pages/property-detail";
import CalendarPage from "./pages/calendar";
import MessagesPage from "./pages/messages";
import PortalPage from "./pages/portal";
import LoginPage from "./pages/login";
import ForgotPasswordPage from "./pages/forgot-password";
import ResetPasswordPage from "./pages/reset-password";
import ActivatePage from "./pages/activate";
import ApprovePage from "./pages/approve";
import ChangePasswordPage from "./pages/change-password";
import DocumentsPage from "./pages/documents";
import InvoicesPage from "./pages/invoices";
import InvoiceDetail from "./pages/invoice-detail";
import RenewalsPage from "./pages/renewals";
import SettingsPage from "./pages/settings";
import AddPage from "./pages/add";
import SearchPage from "./pages/search";
import { AuthProvider, useAuth } from "./components/auth-provider";
import { Skeleton } from "./components/ui/skeleton";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

installNavHistory();

function HomeRedirect() {
  const { user, isLoading } = useAuth();

  if (isLoading)
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Skeleton className="h-12 w-12 rounded-full" />
      </div>
    );
  if (user)
    return <Redirect to={user.role === "client" ? "/portal" : "/dashboard"} />;

  return <Redirect to="/login" />;
}

function LoginRoute() {
  const { user } = useAuth();

  // If the session is already (or just became) authenticated, never show the
  // login form — redirect straight to the right home page. This also closes
  // a race right after signing in: the query cache can flip to "logged in"
  // a tick after the router navigates away from /login, which would
  // otherwise strand the user back on the login screen until they submitted
  // the form a second time.
  if (user) {
    return <Redirect to={user.role === "client" ? "/portal" : "/dashboard"} />;
  }

  return <LoginPage />;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function ProtectedRoutes() {
  const { user } = useAuth();

  if (user?.role === "client") {
    return (
      <Shell>
        <RoutedErrorBoundary>
          <Switch>
            <Route path="/portal" component={PortalPage} />
            <Route path="/change-password" component={ChangePasswordPage} />
            <Route>
              <Redirect to="/portal" />
            </Route>
          </Switch>
        </RoutedErrorBoundary>
      </Shell>
    );
  }

  return (
    <Shell>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/add" component={AddPage} />
          <Route path="/add/:clientId" component={AddPage} />
          <Route path="/activity" component={ActivityPage} />
          <Route path="/notifications">
            <Redirect to="/activity" replace />
          </Route>
          <Route path="/activities">
            <Redirect to="/activity" replace />
          </Route>
          <Route path="/clients" component={ClientsList} />
          <Route path="/clients/:id" component={ClientDetail} />
          <Route path="/cases" component={CasesList} />
          <Route path="/cases/:id" component={CaseDetail} />
          <Route path="/tasks" component={TasksList} />
          <Route path="/lenders" component={LendersList} />
          <Route path="/lenders/:id" component={LenderDetail} />
          <Route path="/properties" component={PropertiesList} />
          <Route path="/properties/:id" component={PropertyDetail} />
          <Route path="/calendar" component={CalendarPage} />
          <Route path="/messages" component={MessagesPage} />
          <Route path="/messages/new" component={MessagesPage} />
          <Route path="/messages/case/:caseId" component={MessagesPage} />
          <Route
            path="/messages/conversation/:conversationId"
            component={MessagesPage}
          />
          <Route path="/documents" component={DocumentsPage} />
          <Route path="/invoices" component={InvoicesPage} />
          <Route path="/invoices/:id" component={InvoiceDetail} />
          <Route path="/renewals" component={RenewalsPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route path="/search" component={SearchPage} />
          <Route path="/change-password" component={ChangePasswordPage} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </Shell>
  );
}

function MainRouter() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Skeleton className="h-12 w-12 rounded-full" />
      </div>
    );
  }

  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/login" component={LoginRoute} />
      <Route path="/staff/login" component={LoginRoute} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/activate" component={ActivatePage} />
      <Route path="/approve" component={ApprovePage} />
      <Route>
        {user ? <ProtectedRoutes key={user.id} /> : <Redirect to="/login" />}
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <MainRouter />
          </AuthProvider>
          <DocumentPreviewHost />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </WouterRouter>
  );
}

export default App;
