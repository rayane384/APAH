import Providers from "../components/Providers";
import Navbar from "../components/Navbar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <Navbar />
      <div className="uk-container uk-margin-top">{children}</div>
    </Providers>
  );
}
