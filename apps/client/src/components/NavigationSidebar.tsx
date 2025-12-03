import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { cn } from "../lib/cn";
import { useState } from "react";
import { signOut, useSession } from "../lib/auth";
import { componentConfigs } from "../routes/ui-components";

// Get component names from playground configs (only in dev)
const uiComponentNames = import.meta.env.DEV
  ? componentConfigs.map((config) => config.name)
  : [];

const navigation = [
  { name: "Dashboard", href: "/", icon: "📊" },
  { name: "Query Log", href: "/queries", icon: "📋" },
  { name: "Query Patterns", href: "/query-patterns", icon: "📈" },
  { name: "Long-term Data", href: "/long-term", icon: "📈" },
  { name: "Server Health", href: "/health", icon: "💚" },
  { name: "Cache Statistics", href: "/cache-stats", icon: "💾" },
  { name: "Upstream Performance", href: "/upstream-stats", icon: "⚡" },
  { name: "Groups", href: "/groups", icon: "👥" },
  { name: "Clients", href: "/clients", icon: "💻" },
  { name: "Domains", href: "/domains", icon: "🌐" },
  { name: "Allowlist", href: "/allowlist", icon: "✅" },
  { name: "Regex Filters", href: "/regex-filters", icon: "🔍" },
  { name: "Adlists", href: "/adlists", icon: "🚫" },
  { name: "Disable Blocking", href: "/disable", icon: "⏸️" },
  { name: "Local DNS", href: "/local-dns", icon: "🏠" },
  { name: "Conditional Forwarding", href: "/conditional-forwarding", icon: "🔄" },
  { name: "Zones", href: "/zones", icon: "🌍" },
  { name: "DDNS", href: "/ddns", icon: "🔄" },
  { name: "Tools", href: "/tools", icon: "🔧" },
  { name: "Scheduled Tasks", href: "/scheduled-tasks", icon: "⏰" },
  { name: "Settings", href: "/settings", icon: "⚙️" },
  { name: "Block Page", href: "/block-page-settings", icon: "🚫" },
  { name: "API Keys", href: "/api-keys", icon: "🔑" },
  ...(import.meta.env.DEV
    ? [{ name: "UI Components", href: "/ui-components", icon: "🎨" }]
    : []),
];

export function NavigationSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [expandedUIComponents, setExpandedUIComponents] = useState(false);
  const { data: session } = useSession();
  const isUIComponentsPage = location.pathname === "/ui-components";

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  // Show hamburger button only on mobile when sidebar is closed
  const showHamburger = !isOpen;

  return (
    <>
      {/* Hamburger button - only on mobile when sidebar is closed */}
      {showHamburger && (
        <button
          onClick={() => setIsOpen(true)}
          className={cn(
            "fixed left-0 top-0 z-40 h-14 w-14 bg-white dark:bg-black border-r border-b border-gray-200 dark:border-gray-700",
            "flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors",
            "md:hidden rounded-br-lg"
          )}
          aria-label="Open sidebar"
        >
          <svg
            className="w-6 h-6 text-gray-600 dark:text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>
      )}

      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className={cn(
            "fixed inset-0 bg-black/50 dark:bg-black/50 z-30 md:hidden",
            "transition-opacity"
          )}
          onClick={() => setIsOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed left-0 top-0 z-40 h-screen w-64 bg-white dark:bg-black border-r border-gray-200 dark:border-gray-700",
          "flex flex-col transition-transform overflow-hidden",
          "shadow-xl md:shadow-none",
          // On desktop, always visible. On mobile, toggle based on isOpen
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        <div
          className={cn(
            "flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700"
          )}
        >
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">
              DNS
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              DNS Server
            </h2>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className={cn(
              "p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors",
              "md:hidden"
            )}
            aria-label="Close sidebar"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-4">
          <div className="space-y-1">
            {navigation.map((item) => {
              const isActive = location.pathname === item.href;
              const isUIComponents = item.href === "/ui-components";
              const showSubmenu =
                isUIComponents && (isUIComponentsPage || expandedUIComponents);

              return (
                <div key={item.name}>
                  <Link
                    to={item.href}
                    onClick={() => {
                      if (isUIComponents) {
                        setExpandedUIComponents(!expandedUIComponents);
                      }
                      // Close sidebar on mobile when link is clicked
                      if (window.innerWidth < 768 && !isUIComponents) {
                        setIsOpen(false);
                      }
                    }}
                    className={cn(
                      "flex items-center justify-between gap-3 px-3 py-2 rounded-lg transition-colors",
                      isActive
                        ? "bg-slate-200 dark:bg-slate-700/50 text-gray-900 dark:text-white border border-slate-300 dark:border-slate-500"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{item.icon}</span>
                      <span className="font-medium">{item.name}</span>
                    </div>
                    {isUIComponents && (
                      <svg
                        className={cn(
                          "w-4 h-4 transition-transform",
                          showSubmenu && "rotate-90"
                        )}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    )}
                  </Link>
                  {showSubmenu && (
                    <div className="ml-8 mt-1 space-y-1">
                      {uiComponentNames.map((componentName) => {
                        const isComponentActive =
                          isUIComponentsPage &&
                          new URLSearchParams(location.search)
                            .get("component")
                            ?.toLowerCase() === componentName.toLowerCase();
                        return (
                          <Link
                            key={componentName}
                            to="/ui-components"
                            search={{ component: componentName }}
                            onClick={() => {
                              if (window.innerWidth < 768) {
                                setIsOpen(false);
                              }
                            }}
                            className={cn(
                              "block px-3 py-1.5 rounded text-sm transition-colors",
                              isComponentActive
                                ? "bg-slate-200 dark:bg-slate-700/50 text-gray-900 dark:text-white border border-slate-300 dark:border-slate-500"
                                : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-white"
                            )}
                          >
                            {componentName}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </nav>

        <div className="p-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span>Server Active</span>
          </div>
          {session?.user && (
            <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                {session.user.email}
              </div>
              <button
                onClick={handleSignOut}
                className="w-full px-3 py-2 text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-700 dark:text-gray-300 transition-colors"
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
