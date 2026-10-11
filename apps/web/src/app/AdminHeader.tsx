import { signOut } from "@/lib/auth";
import styles from "./AdminHeader.module.css";

const LINKS = [
  { key: "routing-log", href: "/routing-log", label: "Routing log" },
  { key: "setup", href: "/setup", label: "Setup" },
  { key: "integrations", href: "/integrations", label: "Integrations" },
] as const;

/** Shared top bar for the signed-in admin pages. */
export default function AdminHeader({
  active,
}: {
  active: (typeof LINKS)[number]["key"];
}) {
  return (
    <header className={styles.header}>
      <nav className={styles.nav} aria-label="Admin">
        <a href="/routing-log" className={styles.brand}>
          Switchboard
        </a>
        <ul className={styles.links}>
          {LINKS.map((link) => (
            <li key={link.key}>
              <a
                href={link.href}
                className={link.key === active ? styles.linkActive : styles.link}
                aria-current={link.key === active ? "page" : undefined}
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button type="submit" className={styles.signOut}>
            Sign out
          </button>
        </form>
      </nav>
    </header>
  );
}
