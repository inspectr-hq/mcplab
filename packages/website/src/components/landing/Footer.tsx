import { Github } from "lucide-react";
import IconInspectr from "@/components/ui/IconInspectr";

const Footer = () => {
  return (
    <footer className="section-footer border-t border-border/50 pt-6 pb-4">
      <div className="container mx-auto px-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <IconInspectr width={28} height={28} from="#7c2d12" to="#f97316" />
            <span className="font-display font-bold text-primary">MCPLab</span>
            <span className="text-muted-foreground text-[10px]">by</span>
            <a href="https://inspectr.dev" target="_blank" rel="noopener noreferrer" className="link-brand text-[10px]">Inspectr</a>
          </div>
          <div className="flex items-center gap-6">
            <a
              href="https://github.com/inspectr-hq/mcplab"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <Github size={18} />
            </a>
            <span className="text-xs text-muted-foreground">
              © {new Date().getFullYear()} Inspectr. All rights reserved.
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
