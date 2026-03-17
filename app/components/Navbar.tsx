"use client";

import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const user = session?.user;

  const links = [
    { href: "/dashboard", label: "Dashboard", exact: true },
    { href: "/dashboard/tickets", label: "Tickets", exact: false },
    { href: "/dashboard/tickets/new", label: "New Ticket", exact: true },
    ...(user?.role === "ADMIN"
      ? [{ href: "/dashboard/timetable", label: "Timetable", exact: true }]
      : []),
  ];

  const isActive = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  return (
    <header className="bg-white border-b border-border sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Left: Logo + Nav */}
          <div className="flex items-center gap-8">
            <Link href="/dashboard" className="flex items-center gap-3 shrink-0">
              <Image
                src="/logo.png"
                alt="Logo"
                width={600}
                height={162}
                className="h-9 w-auto"
                priority
              />
            </Link>

            <nav className="flex items-center gap-1">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive(link.href, link.exact)
                      ? "bg-brand/10 text-brand font-semibold"
                      : "text-brand-gray hover:text-foreground hover:bg-gray-100"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Right: User info + Sign Out */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div
                className="avatar"
                style={{ background: user?.role === "ADMIN" ? "var(--brand-primary)" : "var(--brand-gray)" }}
              >
                {user?.name?.charAt(0) ?? "U"}
              </div>
              <div className="text-sm leading-tight hidden sm:block">
                <div className="font-semibold text-foreground">{user?.name ?? user?.email}</div>
                <div className="text-xs text-brand-gray-light">
                  {user?.role === "ADMIN" ? "Admin" : user?.profile ?? "User"}
                </div>
              </div>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="btn btn-outline btn-sm"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
