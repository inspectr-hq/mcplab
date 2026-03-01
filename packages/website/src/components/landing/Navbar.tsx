import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Menu, X, Github } from "lucide-react";
import IconInspectr from "@/components/ui/IconInspectr";

const Navbar = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showBranding, setShowBranding] = useState(false);

  useEffect(() => {
    const handleScroll = () => setShowBranding(window.scrollY > 220);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const links = [
    { label: "Features", href: "#features" },
    { label: "Quick Start", href: "#quickstart" },
    { label: "GitHub", href: "https://github.com/inspectr-hq/mcplab", external: true },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto w-full flex h-16 items-center justify-between px-4">
        {/* Logo */}
        <div className="flex items-center gap-1.5">
          <a href="#" className="flex items-center gap-2.5">
            <IconInspectr width={28} height={28} from="#7c2d12" to="#f97316" />
            <span className="font-display text-xl font-bold text-primary">MCPLab</span>
          </a>
          <span
            className="text-muted-foreground text-[10px] transition-all duration-300"
            style={{ opacity: showBranding ? 1 : 0, transform: showBranding ? "translateY(0)" : "translateY(-4px)" }}
          >by</span>
          <a
            href="https://inspectr.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="link-brand text-[10px] transition-all duration-300"
            style={{ opacity: showBranding ? 1 : 0, transform: showBranding ? "translateY(0)" : "translateY(-4px)" }}
          >Inspectr</a>
        </div>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-8">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target={link.external ? "_blank" : undefined}
              rel={link.external ? "noopener noreferrer" : undefined}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {link.label}
            </a>
          ))}
          <Button size="sm" className="font-semibold" asChild>
            <a href="#quickstart">Get Started</a>
          </Button>
        </div>

        {/* Mobile toggle */}
        <button className="md:hidden text-foreground" onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-background/95 backdrop-blur-xl px-4 pb-4">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target={link.external ? "_blank" : undefined}
              className="block py-3 text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </a>
          ))}
          <Button size="sm" className="w-full mt-2 font-semibold" asChild>
            <a href="#quickstart">Get Started</a>
          </Button>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
