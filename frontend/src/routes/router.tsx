import { createBrowserRouter } from "react-router-dom";
import { RequireRole } from "./RequireRole";
import { RedirectIfAuthenticated } from "./RedirectIfAuthenticated";
import { AppShell } from "@/components/layout/AppShell";
import { CitizenShell } from "@/components/layout/CitizenShell";
import { OfficerShell } from "@/components/layout/OfficerShell";
import { adminNavItems } from "./navConfig";
import { LandingPage } from "@/pages/public/LandingPage";
import { LoginPage } from "@/pages/public/LoginPage";
import { RegisterPage } from "@/pages/public/RegisterPage";
import { ForbiddenPage } from "@/pages/public/ForbiddenPage";
import { NotFoundPage } from "@/pages/public/NotFoundPage";
import { CitizenDashboardPage } from "@/pages/citizen/DashboardPage";
import { FileComplaintPage } from "@/pages/citizen/FileComplaintPage";
import { MyComplaintsPage } from "@/pages/citizen/MyComplaintsPage";
import { ComplaintDetailPage } from "@/pages/citizen/ComplaintDetailPage";
import { FeedPage } from "@/pages/citizen/FeedPage";
import { GamificationPage } from "@/pages/citizen/GamificationPage";
import { AccountPage } from "@/pages/account/AccountPage";
import { OfficerDashboardPage } from "@/pages/officer/DashboardPage";
import { OfficerQueuePage } from "@/pages/officer/QueuePage";
import { OfficerComplaintDetailPage } from "@/pages/officer/ComplaintDetailPage";
import { OfficerClustersPage } from "@/pages/officer/ClustersPage";
import { OfficerClusterDetailPage } from "@/pages/officer/ClusterDetailPage";
import { AdminDashboardPage } from "@/pages/admin/DashboardPage";
import { AdminComplaintsPage } from "@/pages/admin/ComplaintsPage";
import { AdminComplaintDetailPage } from "@/pages/admin/ComplaintDetailPage";
import { AdminClustersPage } from "@/pages/admin/ClustersPage";
import { AdminZoneMapPage } from "@/pages/admin/ZoneMapPage";
import { AdminClusterDetailPage } from "@/pages/admin/ClusterDetailPage";
import { AdminDisputesPage } from "@/pages/admin/DisputesPage";
import { AdminUsersPage } from "@/pages/admin/UsersPage";
import { AdminZonesPage } from "@/pages/admin/ZonesPage";
import { AdminOfficersPage } from "@/pages/admin/OfficersPage";
import { AdminLeaderboardPage } from "@/pages/admin/LeaderboardPage";
import { AdminSettingsPage } from "@/pages/admin/SettingsPage";

export const router = createBrowserRouter([
  {
    element: <RedirectIfAuthenticated />,
    children: [
      { path: "/", element: <LandingPage /> },
      { path: "/login", element: <LoginPage /> },
      { path: "/register", element: <RegisterPage /> },
    ],
  },
  { path: "/403", element: <ForbiddenPage /> },

  {
    path: "/citizen",
    element: <RequireRole roles={["CITIZEN"]} />,
    children: [
      {
        element: <CitizenShell />,
        children: [
          { index: true, element: <CitizenDashboardPage /> },
          { path: "file", element: <FileComplaintPage /> },
          { path: "complaints", element: <MyComplaintsPage /> },
          {
            path: "complaints/:complaintId",
            element: <ComplaintDetailPage />,
          },
          { path: "feed", element: <FeedPage /> },
          { path: "gamification", element: <GamificationPage /> },
          { path: "account", element: <AccountPage /> },
        ],
      },
    ],
  },

  {
    path: "/officer",
    element: <RequireRole roles={["OFFICER"]} />,
    children: [
      {
        element: <OfficerShell />,
        children: [
          { index: true, element: <OfficerDashboardPage /> },
          { path: "queue", element: <OfficerQueuePage /> },
          {
            path: "queue/:complaintId",
            element: <OfficerComplaintDetailPage />,
          },
          { path: "clusters", element: <OfficerClustersPage /> },
          {
            path: "clusters/:clusterId",
            element: <OfficerClusterDetailPage />,
          },
          { path: "account", element: <AccountPage /> },
        ],
      },
    ],
  },

  {
    path: "/admin",
    element: <RequireRole roles={["ADMIN"]} />,
    children: [
      {
        element: (
          <AppShell
            roleLabelKey="roles.admin"
            accountPath="/admin/account"
            navItems={adminNavItems}
          />
        ),
        children: [
          { index: true, element: <AdminDashboardPage /> },
          { path: "complaints", element: <AdminComplaintsPage /> },
          {
            path: "complaints/:complaintId",
            element: <AdminComplaintDetailPage />,
          },
          { path: "clusters", element: <AdminClustersPage /> },
          {
            path: "clusters/:clusterId",
            element: <AdminClusterDetailPage />,
          },
          { path: "disputes", element: <AdminDisputesPage /> },
          { path: "users", element: <AdminUsersPage /> },
          { path: "zones", element: <AdminZonesPage /> },
          { path: "map", element: <AdminZoneMapPage /> },
          { path: "officers", element: <AdminOfficersPage /> },
          { path: "leaderboard", element: <AdminLeaderboardPage /> },
          { path: "settings", element: <AdminSettingsPage /> },
          { path: "account", element: <AccountPage /> },
        ],
      },
    ],
  },

  { path: "*", element: <NotFoundPage /> },
]);
