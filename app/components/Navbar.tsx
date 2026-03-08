"use client";

import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const user = session?.user;

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + "/");

  return (
    <nav className="uk-navbar-container" data-uk-navbar>
      <div className="uk-navbar-left">
        <Link href="/dashboard" className="uk-navbar-item uk-logo">
          Ticket System
        </Link>
        <ul className="uk-navbar-nav">
          <li className={isActive("/dashboard") && pathname === "/dashboard" ? "uk-active" : ""}>
            <Link href="/dashboard">Dashboard</Link>
          </li>
          <li className={isActive("/dashboard/tickets") ? "uk-active" : ""}>
            <Link href="/dashboard/tickets">Tickets</Link>
          </li>
          {user?.role !== "ADMIN" && (
            <li className={isActive("/dashboard/tickets/new") ? "uk-active" : ""}>
              <Link href="/dashboard/tickets/new">New Ticket</Link>
            </li>
          )}
          {user?.role === "ADMIN" && (
            <li className={isActive("/dashboard/tickets/new") ? "uk-active" : ""}>
              <Link href="/dashboard/tickets/new">New Ticket</Link>
            </li>
          )}
        </ul>
      </div>
      <div className="uk-navbar-right">
        <ul className="uk-navbar-nav">
          <li>
            <a href="#">
              {user?.name ?? user?.email}
              <span
                className="uk-badge uk-margin-small-left"
                style={{ fontSize: "0.7rem", verticalAlign: "middle" }}
              >
                {user?.role === "ADMIN" ? "ADMIN" : user?.profile ?? "USER"}
              </span>
            </a>
          </li>
          <li>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                signOut({ callbackUrl: "/login" });
              }}
            >
              Sign Out
            </a>
          </li>
        </ul>
      </div>
    </nav>
  );
}
