import { Fragment, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "../auth-provider";
import {
  useLogout,
  getGetCurrentUserQueryKey,
  getListClientsQueryOptions,
  getListCasesQueryOptions,
  getListTasksQueryOptions,
  getListLendersQueryOptions,
  getListPropertiesQueryOptions,
  getListCalendarEventsQueryOptions,
  getListInboxQueryOptions,
  getGetDashboardQueryOptions,
  getListActivitiesQueryOptions,
  getListPortalCasesQueryOptions,
  getListPortalDocumentsQueryOptions,
  getListStaffQueryOptions,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Users,
  Briefcase,
  Building2,
  Home,
  LayoutDashboard,
  Calendar,
  ChevronsUpDown,
  KeyRound,
  Plus,
  MessagesSquare,
  CheckSquare,
  Activity,
  Settings,
  TriangleAlert
} from "lucide-react";
import { Button } from "../ui/button";
import { useNewCounts, type NewCountKey } from "@/hooks/use-new-counts";
import { CountBubble } from "@/components/count-bubble";
import {
  GlobalSearchProvider,
  GlobalSearchTrigger,
} from "@/components/search/global-search";
import { ChariotAssistant } from "@/components/assistant/chariot-assistant";

interface NavItem {
  title: string;
  href: string;
  icon: React.ElementType;
  /** Render as a filled call-to-action instead of a plain menu link. */
  emphasis?: boolean;
  /** Which "new" count to show as a bubble next to the item. */
  badge?: NewCountKey;
}

const addItem: NavItem = { title: "Add", href: "/add", icon: Plus };

/** Sidebar menu, one group per array; the gap between groups is deliberate. */
const navGroups: NavItem[][] = [
  [
    { title: "Overview", href: "/dashboard", icon: LayoutDashboard },
    { title: "Cases", href: "/cases", icon: Briefcase },
    { title: "Property", href: "/properties", icon: Home },
    { title: "Clients", href: "/clients", icon: Users },
  ],
  [
    {
      title: "Messages",
      href: "/messages",
      icon: MessagesSquare,
      badge: "messages",
    },
    { title: "Task", href: "/tasks", icon: CheckSquare, badge: "tasks" },
    { title: "Alerts", href: "/alerts", icon: TriangleAlert, badge: "alerts" },
    { title: "Activity", href: "/activity", icon: Activity },
  ],
  [
    { title: "Lenders", href: "/lenders", icon: Building2 },
    { title: "Calendar", href: "/calendar", icon: Calendar },
    { title: "Settings", href: "/settings", icon: Settings },
  ],
];

function AccountMenu({
  variant = "sidebar",
}: {
  variant?: "sidebar" | "header";
}) {
  const { user } = useAuth();
  const logout = useLogout();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();

  if (!user) return null;

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSettled: () => {
        const currentUserKey = getGetCurrentUserQueryKey();
        // Clear the auth cache explicitly before routing to /staff/login.
        // Otherwise LoginRoute can still see the previous user for one render
        // and send the client straight back to /portal.
        qc.setQueryData(currentUserKey, null);
        qc.removeQueries({
          predicate: (query) => query.queryKey[0] !== currentUserKey[0],
        });
        setLocation("/staff/login");
      },
    });
  };

  const initial = user.displayName?.charAt(0) || user.email?.charAt(0) || "U";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === "header" ? (
          <Button variant="ghost" size="icon-sm" aria-label="Account menu">
            <Avatar>
              <AvatarFallback>{initial}</AvatarFallback>
            </Avatar>
          </Button>
        ) : (
          <Button
            variant="outline"
            size="lg"
            className="w-full justify-start px-2"
          >
            <Avatar>
              <AvatarFallback>{initial}</AvatarFallback>
            </Avatar>
            <span className="truncate font-medium">{user.displayName}</span>
            <ChevronsUpDown className="ml-auto" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>My Account</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {user.role === "client" && (
          <DropdownMenuItem onClick={() => setLocation("/change-password")}>
            <KeyRound />
            Change Password
          </DropdownMenuItem>
        )}
        <DropdownMenuItem variant="destructive" onClick={handleLogout}>
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function usePrefetchAllTabs() {
  const qc = useQueryClient();
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    if (user.role === "client") {
      qc.prefetchQuery(getListPortalCasesQueryOptions());
      qc.prefetchQuery(getListPortalDocumentsQueryOptions());
      return;
    }
    qc.prefetchQuery(getGetDashboardQueryOptions());
    qc.prefetchQuery(getListClientsQueryOptions());
    qc.prefetchQuery(getListCasesQueryOptions());
    qc.prefetchQuery(getListTasksQueryOptions());
    qc.prefetchQuery(getListLendersQueryOptions());
    qc.prefetchQuery(getListPropertiesQueryOptions());
    qc.prefetchQuery(getListCalendarEventsQueryOptions());
    qc.prefetchQuery(getListInboxQueryOptions());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
}

const navPrefetch: Record<
  string,
  (qc: ReturnType<typeof useQueryClient>) => void
> = {
  "/dashboard": (qc) => qc.prefetchQuery(getGetDashboardQueryOptions()),
  "/add": (qc) => {
    qc.prefetchQuery(getListClientsQueryOptions());
    qc.prefetchQuery(getListLendersQueryOptions());
    qc.prefetchQuery(getListStaffQueryOptions());
  },
  "/activity": (qc) =>
    qc.prefetchQuery(getListActivitiesQueryOptions({ page: 1, pageSize: 25 })),
  "/clients": (qc) => qc.prefetchQuery(getListClientsQueryOptions()),
  "/cases": (qc) => qc.prefetchQuery(getListCasesQueryOptions()),
  "/tasks": (qc) => qc.prefetchQuery(getListTasksQueryOptions()),
  "/lenders": (qc) => qc.prefetchQuery(getListLendersQueryOptions()),
  "/properties": (qc) => qc.prefetchQuery(getListPropertiesQueryOptions()),
  "/calendar": (qc) => qc.prefetchQuery(getListCalendarEventsQueryOptions()),
  "/messages": (qc) => qc.prefetchQuery(getListInboxQueryOptions()),
};

/** One stock Badge colour per kind of "new" thing so the bubbles read at a glance. */
const badgeVariant: Record<
  NewCountKey,
  React.ComponentProps<typeof CountBubble>["variant"]
> = {
  messages: "default",
  tasks: "secondary",
  enquiries: "secondary",
  alerts: "destructive",
};

function AppNav({
  items,
  counts,
}: {
  items: NavItem[];
  counts: Record<NewCountKey, number>;
}) {
  const [location] = useLocation();
  const qc = useQueryClient();
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem
          key={item.href}
          className={item.emphasis ? "mb-2" : undefined}
        >
          <SidebarMenuButton
            asChild
            isActive={location.startsWith(item.href)}
            className={
              item.emphasis
                ? "justify-center bg-primary font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground data-[active=true]:bg-primary data-[active=true]:text-primary-foreground group-data-[collapsible=icon]:justify-center"
                : undefined
            }
          >
            <Link
              href={item.href}
              onMouseEnter={() => navPrefetch[item.href]?.(qc)}
              onTouchStart={() => navPrefetch[item.href]?.(qc)}
              onClick={() => {
                if (isMobile) setOpenMobile(false);
              }}
            >
              <item.icon />
              <span>{item.title}</span>
            </Link>
          </SidebarMenuButton>
          {item.badge && counts[item.badge] > 0 && (
            <SidebarMenuBadge className="px-0">
              <CountBubble
                count={counts[item.badge]}
                variant={badgeVariant[item.badge]}
              />
            </SidebarMenuBadge>
          )}
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  usePrefetchAllTabs();

  const isClient = user?.role === "client";
  const counts = useNewCounts(!!user && !isClient);
  const displayedNavGroups = isClient
    ? [[{ title: "Portal", href: "/portal", icon: Home }]]
    : [[addItem], ...navGroups];

  // The logo doubles as a home link alongside the Overview menu item.
  const logo = (
    <Link href={isClient ? "/portal" : "/dashboard"} aria-label="Home">
      <img
        src={`${import.meta.env.BASE_URL}chariot-logo.png`}
        alt="Chariot Financial Solutions"
        className="h-14 w-auto max-w-full object-contain"
      />
    </Link>
  );

  return (
    <GlobalSearchProvider enabled={!!user && !isClient}>
      <SidebarProvider
        className="bg-page"
        // Narrow rail: five short menu items plus the four circle buttons below.
        // Same surface colour as Card so the rail reads as one more card.
        style={{ "--sidebar-width": "12.1rem", "--sidebar": "var(--card)" } as React.CSSProperties}
      >
        <Sidebar collapsible="offcanvas" className="rounded-r-xl overflow-hidden shadow-sm">
          <SidebarHeader className="h-24 items-center justify-center px-4">
            {logo}
          </SidebarHeader>
          <SidebarContent>
            {/* Stock SidebarSeparator's mx-2 + w-full overflows the rail; inset it instead. */}
            <div className="px-2">
              <SidebarSeparator className="mx-0" />
            </div>
            {displayedNavGroups.map((items, index) => (
              <Fragment key={index}>
                {index > 0 && (
                  <div className="px-2">
                    <SidebarSeparator className="mx-0" />
                  </div>
                )}
                <SidebarGroup className={index === 0 ? "pt-2" : undefined}>
                  <SidebarGroupContent>
                    <AppNav items={items} counts={counts} />
                  </SidebarGroupContent>
                </SidebarGroup>
              </Fragment>
            ))}
          </SidebarContent>
          <SidebarFooter className="gap-2 border-t border-sidebar-border">
            {!isClient && <GlobalSearchTrigger />}
            <AccountMenu />
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="min-w-0 min-h-0 bg-page">
          <header className="h-16 border-b border-border bg-card flex items-center justify-between px-4 sticky top-0 z-10 md:hidden">
            <div className="flex items-center gap-2">
              <SidebarTrigger />
              {logo}
            </div>
            <div className="flex items-center gap-1">
              {!isClient && <GlobalSearchTrigger variant="icon" />}
              <AccountMenu variant="header" />
            </div>
          </header>
          <div className="flex-1 min-h-0 overflow-x-hidden">{children}</div>
        </SidebarInset>
        {!isClient && <ChariotAssistant />}
      </SidebarProvider>
    </GlobalSearchProvider>
  );
}
