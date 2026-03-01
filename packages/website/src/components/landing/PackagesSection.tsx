import { motion } from "framer-motion";
import { ExternalLink } from "lucide-react";

const packages = [
  {
    name: "@inspectr/mcplab",
    description: "CLI and local app server",
    href: "https://www.npmjs.com/package/@inspectr/mcplab",
  },
  {
    name: "@inspectr/mcplab-core",
    description: "Core evaluation engine",
    href: "https://www.npmjs.com/package/@inspectr/mcplab-core",
  },
  {
    name: "@inspectr/mcplab-mcp-server",
    description: "MCP tools for runs, traces and reports",
    href: "https://www.npmjs.com/package/@inspectr/mcplab-mcp-server",
  },
  {
    name: "@inspectr/mcplab-reporting",
    description: "Report generation helpers",
    href: "https://www.npmjs.com/package/@inspectr/mcplab-reporting",
  },
];

const PackagesSection = () => {
  return (
    <section id="packages" className="py-20 border-t border-border/50">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 className="font-display text-3xl sm:text-4xl font-bold mb-4">
            Published <span className="text-primary">Packages</span>
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Install individual packages or use the CLI to get everything at once.
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
          {packages.map((pkg, i) => (
            <motion.a
              key={pkg.name}
              href={pkg.href}
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
              className="group flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-5 hover:border-primary/40 transition-all"
            >
              <div>
                <p className="font-mono text-sm font-semibold text-foreground group-hover:text-primary transition-colors mb-1">
                  {pkg.name}
                </p>
                <p className="text-sm text-muted-foreground">{pkg.description}</p>
              </div>
              <ExternalLink size={14} className="text-muted-foreground group-hover:text-primary transition-colors shrink-0 mt-1" />
            </motion.a>
          ))}
        </div>
      </div>
    </section>
  );
};

export default PackagesSection;
